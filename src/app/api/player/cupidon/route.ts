import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,10}$/),
  firstPlayerId: z.string().uuid(),
  secondPlayerId: z.string().uuid(),
});

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function playerCookieName(code: string) {
  return `nocturne_player_${code}`;
}

export async function POST(request: Request) {
  try {
    // Protection complémentaire contre les requêtes cross-origin.
    const origin = request.headers.get("origin");

    if (
      origin &&
      new URL(origin).origin !== new URL(request.url).origin
    ) {
      return json({ error: "Origine de requête non autorisée." }, 403);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Requête invalide." }, 400);
    }

    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return json(
        { error: "Vérifie le code de la partie et les deux joueurs." },
        400
      );
    }

    const { code, firstPlayerId, secondPlayerId } = parsed.data;

    if (firstPlayerId === secondPlayerId) {
      return json(
        { error: "Tu dois sélectionner deux joueurs différents." },
        400
      );
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(playerCookieName(code))?.value;

    if (!token) {
      return json(
        { error: "Ta session joueur est introuvable. Rejoins à nouveau la partie." },
        401
      );
    }

    const tokenHash = hashToken(token);
    const admin = createAdminClient();

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, status")
      .eq("invite_code", code)
      .maybeSingle();

    if (gameError) {
      console.error("Lecture de la partie impossible:", gameError.message);
      return json({ error: "Impossible de charger la partie." }, 500);
    }

    if (!game) {
      return json({ error: "Partie introuvable." }, 404);
    }

    if (game.status !== "cupidon_selection") {
      return json(
        { error: "La phase de Cupidon n'est pas ouverte." },
        409
      );
    }

    const { data: player, error: playerError } = await admin
      .from("game_players")
      .select("id, registration_status, life_status, session_expires_at")
      .eq("game_id", game.id)
      .eq("session_token_hash", tokenHash)
      .maybeSingle();

    if (playerError) {
      console.error("Lecture joueur impossible:", playerError.message);
      return json({ error: "Impossible de vérifier ta session." }, 500);
    }

    if (!player || player.registration_status !== "approved") {
      return json({ error: "Session joueur non autorisée." }, 403);
    }

    if (
      !player.session_expires_at ||
      new Date(player.session_expires_at).getTime() <= Date.now()
    ) {
      return json({ error: "Ta session a expiré." }, 401);
    }

    if (player.life_status !== "alive") {
      return json({ error: "Seul un joueur vivant peut agir." }, 403);
    }

    const { data: cupidonRole, error: roleError } = await admin
      .from("player_roles")
      .select("role_key")
      .eq("game_id", game.id)
      .eq("player_id", player.id)
      .maybeSingle();

    if (roleError) {
      console.error("Vérification du rôle impossible:", roleError.message);
      return json({ error: "Impossible de vérifier ton rôle." }, 500);
    }

    if (cupidonRole?.role_key !== "cupidon") {
      return json(
        { error: "Seul Cupidon peut utiliser cette action." },
        403
      );
    }

    // UUID de corrélation pour faciliter le diagnostic serveur.
    const requestId = randomUUID();

    const { data, error } = await admin.rpc("submit_cupidon_link", {
      p_game_id: game.id,
      p_cupidon_player_id: player.id,
      p_player_a_id: firstPlayerId,
      p_player_b_id: secondPlayerId,
    });

    if (error) {
      console.error("Échec de l'action Cupidon:", {
        requestId,
        message: error.message,
      });

      const message = error.message.toLowerCase();

      if (
        message.includes("not open") ||
        message.includes("already been created")
      ) {
        return json(
          { error: "Cette action a déjà été effectuée ou n'est plus disponible." },
          409
        );
      }

      if (
        message.includes("eligible player") ||
        message.includes("different players")
      ) {
        return json(
          { error: "Sélection invalide. Choisis deux joueurs vivants différents." },
          400
        );
      }

      if (
        message.includes("eligible cupidon") ||
        message.includes("permission")
      ) {
        return json(
          { error: "Cette action n'est pas autorisée." },
          403
        );
      }

      return json(
        {
          error: "L'action n'a pas pu être enregistrée.",
          requestId,
        },
        500
      );
    }

    return json({ success: true, result: data });
  } catch (error) {
    console.error("Erreur API Cupidon:", error);
    return json({ error: "Une erreur serveur est survenue." }, 500);
  }
}