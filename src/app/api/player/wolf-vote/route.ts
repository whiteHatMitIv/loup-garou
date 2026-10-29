import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const voteSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,10}$/),
  targetPlayerId: z.string().uuid(),
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
    const origin = request.headers.get("origin");

    if (
      origin &&
      new URL(origin).origin !== new URL(request.url).origin
    ) {
      return json({ error: "Origine non autorisée." }, 403);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Requête invalide." }, 400);
    }

    const parsed = voteSchema.safeParse(body);

    if (!parsed.success) {
      return json(
        { error: "Code de partie ou cible invalide." },
        400
      );
    }

    const { code, targetPlayerId } = parsed.data;
    const cookieStore = await cookies();
    const token = cookieStore.get(playerCookieName(code))?.value;

    if (!token) {
      return json(
        { error: "Session introuvable. Rejoins à nouveau la partie." },
        401
      );
    }

    const admin = createAdminClient();

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, status")
      .eq("invite_code", code)
      .maybeSingle();

    if (gameError) {
      console.error("Erreur de lecture de la partie:", gameError.message);
      return json({ error: "Impossible de charger la partie." }, 500);
    }

    if (!game) {
      return json({ error: "Partie introuvable." }, 404);
    }

    if (game.status !== "night_wolf_vote") {
      return json(
        { error: "Le vote des Loups n'est pas ouvert." },
        409
      );
    }

    const { data: player, error: playerError } = await admin
      .from("game_players")
      .select(
        "id, registration_status, life_status, session_expires_at"
      )
      .eq("game_id", game.id)
      .eq("session_token_hash", hashToken(token))
      .maybeSingle();

    if (playerError) {
      console.error("Erreur de session joueur:", playerError.message);
      return json({ error: "Impossible de vérifier la session." }, 500);
    }

    if (
      !player ||
      player.registration_status !== "approved" ||
      player.life_status !== "alive"
    ) {
      return json(
        { error: "Tu n'es pas autorisé à voter dans cette partie." },
        403
      );
    }

    if (
      !player.session_expires_at ||
      new Date(player.session_expires_at).getTime() <= Date.now()
    ) {
      return json({ error: "Ta session a expiré." }, 401);
    }

    const { data: role, error: roleError } = await admin
      .from("player_roles")
      .select("role_key")
      .eq("game_id", game.id)
      .eq("player_id", player.id)
      .maybeSingle();

    if (roleError) {
      console.error("Erreur de lecture du rôle:", roleError.message);
      return json({ error: "Impossible de vérifier ton rôle." }, 500);
    }

    if (role?.role_key !== "loup_garou") {
      return json(
        { error: "Seuls les Loups peuvent participer à ce vote." },
        403
      );
    }

    const { data, error } = await admin.rpc("submit_wolf_vote", {
      p_game_id: game.id,
      p_player_id: player.id,
      p_target_player_id: targetPlayerId,
    });

    if (error) {
      console.error("Enregistrement du vote impossible:", error.message);

      const message = error.message.toLowerCase();

      if (message.includes("not open")) {
        return json({ error: "Le vote vient d'être clôturé." }, 409);
      }

      if (
        message.includes("not eligible") ||
        message.includes("cannot target")
      ) {
        return json(
          { error: "Cette cible n'est pas autorisée." },
          400
        );
      }

      if (message.includes("permission")) {
        return json({ error: "Action non autorisée." }, 403);
      }

      return json(
        { error: "Le vote n'a pas pu être enregistré." },
        500
      );
    }

    return json({
      success: true,
      message: "Ton choix a été enregistré.",
      result: data,
    });
  } catch (error) {
    console.error("Erreur POST /api/player/wolf-vote:", error);

    return json({ error: "Une erreur serveur est survenue." }, 500);
  }
}