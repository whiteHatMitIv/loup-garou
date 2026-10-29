
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const actionSchema = z.object({
  code: z.string().trim().min(1).max(100),
  saveLife: z.boolean(),
  poisonTargetPlayerId: z.string().uuid().nullable(),
});

type WitchPhaseMetadata = {
  life_potion_used?: boolean;
  death_potion_used?: boolean;
  wolf_target_player_id?: string | null;
};

async function authenticateWitch(code: string) {
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
    .select("id, name, status, invite_code")
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
        { error: "Seul un joueur validé et vivant peut agir." },
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

  if (roleError || assignment?.role_key !== "sorciere") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Cette action est réservée à la Sorcière." },
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

  const context = await authenticateWitch(code);

  if (!context.ok) {
    return context.response;
  }

  const { admin, game, player } = context;

  if (game.status !== "night_witch_action") {
    return NextResponse.json(
      { error: "La phase de la Sorcière n'est pas active." },
      { status: 409 }
    );
  }

  const { data: activePhase, error: phaseError } = await admin
    .from("game_phases")
    .select("id, phase_number, metadata, status")
    .eq("game_id", game.id)
    .eq("phase_key", "night_witch_action")
    .eq("status", "open")
    .order("phase_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (phaseError || !activePhase) {
    console.error("Phase Sorcière introuvable :", phaseError);

    return NextResponse.json(
      { error: "Impossible de charger la phase de la Sorcière." },
      { status: 500 }
    );
  }

  const { data: wolfPhase, error: wolfPhaseError } = await admin
    .from("game_phases")
    .select("id, phase_number, metadata")
    .eq("game_id", game.id)
    .eq("phase_key", "night_wolf_vote")
    .eq("status", "resolved")
    .order("phase_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (wolfPhaseError || !wolfPhase) {
    return NextResponse.json(
      { error: "Le vote des Loups n'a pas été résolu." },
      { status: 409 }
    );
  }

  const wolfMetadata =
    (wolfPhase.metadata ?? {}) as WitchPhaseMetadata;

  const wolfTargetId =
    typeof wolfMetadata.wolf_target_player_id === "string"
      ? wolfMetadata.wolf_target_player_id
      : null;

  let wolfVictim: { id: string; displayName: string } | null = null;

  if (wolfTargetId) {
    const { data: target, error: targetError } = await admin
      .from("game_players")
      .select("id, display_name")
      .eq("game_id", game.id)
      .eq("id", wolfTargetId)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json(
        { error: "Impossible de récupérer la victime des Loups." },
        { status: 500 }
      );
    }

    if (target) {
      wolfVictim = {
        id: target.id,
        displayName: target.display_name,
      };
    }
  }

  const { data: history, error: historyError } = await admin
    .from("game_phases")
    .select("metadata")
    .eq("game_id", game.id)
    .eq("phase_key", "night_witch_action")
    .eq("status", "resolved");

  if (historyError) {
    return NextResponse.json(
      { error: "Impossible de vérifier l'historique des potions." },
      { status: 500 }
    );
  }

  const pastPhases = (history ?? []) as {
    metadata: WitchPhaseMetadata | null;
  }[];

  const lifePotionAvailable = !pastPhases.some(
    (phase) => phase.metadata?.life_potion_used === true
  );

  const deathPotionAvailable = !pastPhases.some(
    (phase) => phase.metadata?.death_potion_used === true
  );

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
    player: {
      id: player.id,
      displayName: player.display_name,
    },
    wolfVictim,
    lifePotionAvailable,
    deathPotionAvailable,
    eligibleTargets: (targets ?? []).map((target) => ({
      id: target.id,
      displayName: target.display_name,
    })),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Les choix transmis sont invalides." },
      { status: 400 }
    );
  }

  const {
    code,
    saveLife,
    poisonTargetPlayerId,
  } = parsed.data;

  const context = await authenticateWitch(code);

  if (!context.ok) {
    return context.response;
  }

  const { admin, game, player } = context;

  if (game.status !== "night_witch_action") {
    return NextResponse.json(
      { error: "La phase de la Sorcière n'est plus active." },
      { status: 409 }
    );
  }

  const { data, error } = await admin.rpc("submit_witch_action", {
    p_game_id: game.id,
    p_player_id: player.id,
    p_save_life: saveLife,
    p_poison_target_player_id: poisonTargetPlayerId,
  });

  if (error) {
    console.error("Échec de l'action de la Sorcière :", error);

    return NextResponse.json(
      { error: error.message || "Impossible d'enregistrer les actions." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    result: data,
    message: "Les actions de la Sorcière ont été enregistrées.",
  });
}
