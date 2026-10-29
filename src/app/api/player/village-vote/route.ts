
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const voteSchema = z.object({
  code: z.string().trim().min(1).max(100),
  targetPlayerId: z.string().uuid(),
});

async function authenticatePlayer(code: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(`nocturne_player_${code}`)?.value;

  if (!token) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Session joueur introuvable. Rejoins de nouveau la partie." },
        { status: 401 }
      ),
    };
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();

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

  if (
    player.registration_status !== "approved" ||
    player.life_status !== "alive"
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Seul un joueur validé et vivant peut voter." },
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

  const context = await authenticatePlayer(code);

  if (!context.ok) return context.response;

  const { admin, game, player } = context;

  if (
    game.status !== "village_vote_1" &&
    game.status !== "village_vote_2"
  ) {
    return NextResponse.json(
      { error: "Aucun scrutin du village n'est actuellement ouvert." },
      { status: 409 }
    );
  }

  const { data: phase, error: phaseError } = await admin
    .from("game_phases")
    .select("id, phase_key, metadata")
    .eq("game_id", game.id)
    .eq("phase_key", game.status)
    .eq("status", "open")
    .order("phase_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (phaseError || !phase) {
    return NextResponse.json(
      { error: "Impossible de retrouver le scrutin ouvert." },
      { status: 500 }
    );
  }

  const { data: playerData, error: playersError } = await admin
    .from("game_players")
    .select("id, display_name")
    .eq("game_id", game.id)
    .eq("registration_status", "approved")
    .eq("life_status", "alive")
    .order("display_name", { ascending: true });

  if (playersError) {
    return NextResponse.json(
      { error: "Impossible de charger les joueurs." },
      { status: 500 }
    );
  }

  let targets = playerData ?? [];

  if (phase.phase_key === "village_vote_2") {
    const metadata = phase.metadata as {
      eligible_target_ids?: string[];
    } | null;

    const eligibleIds = new Set(metadata?.eligible_target_ids ?? []);
    targets = targets.filter((target) => eligibleIds.has(target.id));
  }

  const { data: existingVote, error: voteError } = await admin
    .from("votes")
    .select("target_player_id")
    .eq("game_id", game.id)
    .eq("phase_id", phase.id)
    .eq("voter_player_id", player.id)
    .eq("vote_kind", "village")
    .maybeSingle();

  if (voteError) {
    return NextResponse.json(
      { error: "Impossible de récupérer ton vote actuel." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    gameStatus: game.status,
    phaseKey: phase.phase_key,
    currentTargetId: existingVote?.target_player_id ?? null,
    targets: targets.map((target) => ({
      id: target.id,
      displayName: target.display_name,
    })),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = voteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Les informations du vote sont invalides." },
      { status: 400 }
    );
  }

  const { code, targetPlayerId } = parsed.data;
  const context = await authenticatePlayer(code);

  if (!context.ok) return context.response;

  const { admin, game, player } = context;

  const { data, error } = await admin.rpc("submit_village_vote", {
    p_game_id: game.id,
    p_player_id: player.id,
    p_target_player_id: targetPlayerId,
  });

  if (error) {
    console.error("Enregistrement du vote impossible :", error);

    return NextResponse.json(
      { error: error.message || "Impossible d'enregistrer ton vote." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    result: data,
    message: "Ton vote est enregistré. Tu peux le modifier tant que le scrutin reste ouvert.",
  });
}
