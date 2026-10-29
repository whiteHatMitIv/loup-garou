
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const hunterSchema = z.object({
  code: z.string().trim().min(1).max(100),
  targetPlayerId: z.string().uuid(),
});

async function authenticateHunter(code: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(`nocturne_player_${code}`)?.value;

  if (!token) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Session joueur introuvable." },
        { status: 401 }
      ),
    };
  }

  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data: game, error: gameError } = await admin
    .from("games")
    .select("id, status, invite_code")
    .eq("invite_code", code)
    .maybeSingle();

  if (gameError || !game) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Partie introuvable." },
        { status: 404 }
      ),
    };
  }

  const { data: player, error: playerError } = await admin
    .from("game_players")
    .select("id, display_name, registration_status, life_status")
    .eq("game_id", game.id)
    .eq("session_token_hash", tokenHash)
    .gt("session_expires_at", new Date().toISOString())
    .maybeSingle();

  if (playerError || !player) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Session expirée ou joueur introuvable." },
        { status: 401 }
      ),
    };
  }

  if (player.registration_status !== "approved") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Ce joueur n'est pas validé." },
        { status: 403 }
      ),
    };
  }

  const { data: assignment, error: roleError } = await admin
    .from("player_roles")
    .select("role_key")
    .eq("game_id", game.id)
    .eq("player_id", player.id)
    .maybeSingle();

  if (roleError || assignment?.role_key !== "chasseur") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Cette action est réservée au Chasseur." },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    admin,
    game,
    player,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();

  if (!code) {
    return NextResponse.json(
      { error: "Le code de la partie est obligatoire." },
      { status: 400 }
    );
  }

  const context = await authenticateHunter(code);

  if (!context.ok) return context.response;

  const { admin, game, player } = context;

  if (
    game.status !== "hunter_action" ||
    player.life_status !== "dead"
  ) {
    return NextResponse.json(
      { error: "Le pouvoir du Chasseur n'est pas actif." },
      { status: 409 }
    );
  }

  const { data: phase, error: phaseError } = await admin
    .from("game_phases")
    .select("id, metadata, phase_number")
    .eq("game_id", game.id)
    .eq("phase_key", "hunter_action")
    .eq("status", "open")
    .order("phase_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    phaseError ||
    !phase ||
    phase.metadata?.hunter_player_id !== player.id
  ) {
    return NextResponse.json(
      { error: "Aucune action du Chasseur ne t'est attribuée." },
      { status: 403 }
    );
  }

  const { data: targets, error: targetsError } = await admin
    .from("game_players")
    .select("id, display_name")
    .eq("game_id", game.id)
    .eq("registration_status", "approved")
    .eq("life_status", "alive")
    .order("display_name", { ascending: true });

  if (targetsError) {
    return NextResponse.json(
      { error: "Impossible de charger les cibles disponibles." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    targets: (targets ?? []).map((target) => ({
      id: target.id,
      displayName: target.display_name,
    })),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = hunterSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Les informations transmises sont invalides." },
      { status: 400 }
    );
  }

  const context = await authenticateHunter(parsed.data.code);

  if (!context.ok) return context.response;

  const { admin, game, player } = context;

  if (
    game.status !== "hunter_action" ||
    player.life_status !== "dead"
  ) {
    return NextResponse.json(
      { error: "Le pouvoir du Chasseur n'est pas actif." },
      { status: 409 }
    );
  }

  const { data, error } = await admin.rpc("submit_hunter_shot", {
    p_game_id: game.id,
    p_player_id: player.id,
    p_target_player_id: parsed.data.targetPlayerId,
  });

  if (error) {
    console.error("Tir du Chasseur impossible :", error);

    return NextResponse.json(
      { error: error.message || "Impossible d'enregistrer le tir." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    result: data,
    message:
      data?.game_status === "game_over"
        ? "Le tir a été résolu. La partie est terminée."
        : "Le tir a été résolu et la nuit est terminée.",
  });
}
