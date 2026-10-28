import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,10}$/, "Code de partie invalide.");

const joinSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(40),
});

const SESSION_DURATION = 60 * 60 * 24 * 30;

function playerCookieName(code: string) {
  return `nocturne_player_${code}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr-FR");
}

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

// GET /api/join?code=ABC123
// Retourne les informations publiques de la partie
// et uniquement le rôle du joueur associé à sa session.
export async function GET(request: Request) {
  try {
    const rawCode = new URL(request.url).searchParams.get("code");
    const parsedCode = codeSchema.safeParse(rawCode);

    if (!parsedCode.success) {
      return jsonResponse(
        { error: "Le code de la partie est invalide." },
        400
      );
    }

    const code = parsedCode.data;
    const admin = createAdminClient();

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, name, status")
      .eq("invite_code", code)
      .maybeSingle();

    if (gameError) {
      console.error("Lecture de la partie impossible:", gameError.message);

      return jsonResponse(
        { error: "Impossible de charger cette partie." },
        500
      );
    }

    if (!game) {
      return jsonResponse(
        { error: "Aucune partie ne correspond à ce code." },
        404
      );
    }

    let eligibleTargets: { id: string; display_name: string }[] = [];

    const cookieStore = await cookies();
    const cookieName = playerCookieName(code);
    const token = cookieStore.get(cookieName)?.value;

    type PlayerRole = {
      key: string;
      displayName: string;
      camp: string;
      description: string;
    };

    type PlayerInfo = {
      displayName: string;
      registrationStatus: string;
      lifeStatus: string;
      role: PlayerRole | null;
    };

    let player: PlayerInfo | null = null;
    let clearCookie = false;

    if (token) {
      const tokenHash = hashToken(token);

      const { data: existingPlayer, error: playerError } = await admin
        .from("game_players")
        .select(
          "id, display_name, registration_status, life_status, session_expires_at"
        )
        .eq("game_id", game.id)
        .eq("session_token_hash", tokenHash)
        .maybeSingle();

      if (playerError) {
        console.error(
          "Lecture de la session joueur impossible:",
          playerError.message
        );

        return jsonResponse(
          { error: "Impossible de retrouver ta session." },
          500
        );
      }

      if (!existingPlayer) {
        clearCookie = true;
      } else {
        const expiresAt = existingPlayer.session_expires_at
          ? new Date(existingPlayer.session_expires_at).getTime()
          : 0;

        if (expiresAt <= Date.now()) {
          clearCookie = true;
        } else {
          let role: PlayerRole | null = null;

          // Le rôle n'est accessible qu'au joueur authentifié
          // par sa session, après le lancement de la partie.
          if (
            existingPlayer.registration_status === "approved" &&
            game.status !== "lobby"
          ) {
            const { data: assignment, error: assignmentError } =
              await admin
                .from("player_roles")
                .select("role_key")
                .eq("game_id", game.id)
                .eq("player_id", existingPlayer.id)
                .maybeSingle();

            if (assignmentError) {
              console.error(
                "Lecture du rôle attribué impossible:",
                assignmentError.message
              );

              return jsonResponse(
                { error: "Impossible de récupérer ton rôle." },
                500
              );
            }

            if (assignment) {
              const { data: roleDefinition, error: roleError } =
                await admin
                  .from("roles")
                  .select("role_key, display_name, camp, description")
                  .eq("role_key", assignment.role_key)
                  .maybeSingle();

              if (roleError) {
                console.error(
                  "Lecture de la définition du rôle impossible:",
                  roleError.message
                );

                return jsonResponse(
                  { error: "Impossible de récupérer les informations du rôle." },
                  500
                );
              }

              if (roleDefinition) {
                role = {
                  key: roleDefinition.role_key,
                  displayName: roleDefinition.display_name,
                  camp: roleDefinition.camp,
                  description: roleDefinition.description,
                };
              }
            }

            if (
              role?.key == "cupidon" &&
              game.status === "cupidon_selection"
            ) {
              const { data: targets, error: targetsError } = await admin
                .from("game_players")
                .select("id, display_name")
                .eq("game_id", game.id)
                .eq("registration_status", "approved")
                .eq("life_status", "alive")
                .order("normalized_name", { ascending: true });

              if (targetsError) {
                console.error(
                  "Lecture des cibles éligibles impossible:",
                  targetsError.message
                );

                return jsonResponse(
                  { error: "Impossible de récupérer les joueurs disponibles." },
                  500
                );
              }

              eligibleTargets = (targets ?? []).map((t) => ({
                id: t.id,
                display_name: t.display_name,
              }));
            }
          }

          player = {
            displayName: existingPlayer.display_name,
            registrationStatus: existingPlayer.registration_status,
            lifeStatus: existingPlayer.life_status,
            role,
          };
        }
      }
    }

    const response = jsonResponse({
      game: {
        name: game.name,
        status: game.status,
      },
      player,
      eligibleTargets,
    });

    if (clearCookie) {
      response.cookies.delete(cookieName);
    }

    return response;
  } catch (error) {
    console.error("Erreur GET /api/join:", error);

    return jsonResponse(
      { error: "Une erreur serveur est survenue." },
      500
    );
  }
}

// POST /api/join
// Crée une demande d'inscription et une session individuelle.
export async function POST(request: Request) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "Les données envoyées sont invalides." },
        400
      );
    }

    const parsed = joinSchema.safeParse(body);

    if (!parsed.success) {
      return jsonResponse(
        {
          error:
            parsed.error.issues[0]?.message ??
            "Vérifie le code de la partie et ton prénom.",
        },
        400
      );
    }

    const code = parsed.data.code;
    const displayName = parsed.data.name.normalize("NFC").trim();
    const normalizedName = normalizeName(displayName);

    if (!normalizedName) {
      return jsonResponse(
        { error: "Saisis un prénom valide." },
        400
      );
    }

    const admin = createAdminClient();

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, name, status")
      .eq("invite_code", code)
      .maybeSingle();

    if (gameError) {
      console.error("Recherche de partie impossible:", gameError.message);

      return jsonResponse(
        { error: "Impossible de vérifier cette partie." },
        500
      );
    }

    if (!game) {
      return jsonResponse(
        { error: "Aucune partie ne correspond à ce code." },
        404
      );
    }

    if (game.status !== "lobby") {
      return jsonResponse(
        { error: "Les inscriptions à cette partie sont fermées." },
        409
      );
    }

    // Le jeton brut n'est jamais enregistré dans la base.
    const sessionToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(sessionToken);

    const expiresAt = new Date(
      Date.now() + SESSION_DURATION * 1000
    ).toISOString();

    const { error: insertError } = await admin
      .from("game_players")
      .insert({
        game_id: game.id,
        display_name: displayName,
        normalized_name: normalizedName,
        registration_status: "pending",
        life_status: "not_started",
        session_token_hash: tokenHash,
        session_expires_at: expiresAt,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        return jsonResponse(
          {
            error:
              "Ce prénom est déjà utilisé dans cette partie. Choisis un nom d'affichage distinct.",
          },
          409
        );
      }

      console.error(
        "Création de l'inscription impossible:",
        insertError.message
      );

      return jsonResponse(
        { error: "Impossible d'enregistrer ton inscription." },
        500
      );
    }

    const response = jsonResponse(
      {
        game: {
          name: game.name,
          status: game.status,
        },
        player: {
          displayName,
          registrationStatus: "pending",
          lifeStatus: "not_started",
        },
        message: "Ta demande a été envoyée au maître du jeu.",
      },
      201
    );

    response.cookies.set(playerCookieName(code), sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION,
    });

    return response;
  } catch (error) {
    console.error("Erreur POST /api/join:", error);

    return jsonResponse(
      { error: "Une erreur serveur est survenue." },
      500
    );
  }
}