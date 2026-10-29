
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

const actionSchema = z.object({
  code: z.string().trim().min(1).max(100),
  targetPlayerId: z.string().uuid(),
});

type SeerRpcResult = {
  success: boolean;
  inspected_player_id: string;
  inspected_player_name: string;
  target_role_key: string;
  next_phase: string;
};

async function authenticateSeer(code: string) {
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

  if (roleError || assignment?.role_key !== "voyante") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Cette action est réservée à la Voyante." },
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

  const context = await authenticateSeer(code);

  if (!context.ok) {
    return context.response;
  }

  const { admin, game, player } = context;

  if (game.status !== "night_seer_action") {
    return NextResponse.json(
      { error: "La phase de la Voyante n'est pas active." },
      { status: 409 }
    );
  }

  const { data: phase, error: phaseError } = await admin
    .from("game_phases")
    .select("id")
    .eq("game_id", game.id)
    .eq("phase_key", "night_seer_action")
    .eq("status", "open")
    .order("phase_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (phaseError || !phase) {
    console.error("Phase de la Voyante introuvable :", phaseError);

    return NextResponse.json(
      { error: "Impossible de charger la phase de la Voyante." },
      { status: 500 }
    );
  }

  const { data: targets, error: targetsError } = await admin
    .from("game_players")
    .select("id, display_name")
    .eq("game_id", game.id)
    .eq("registration_status", "approved")
    .eq("life_status", "alive")
    .neq("id", player.id)
    .order("display_name", { ascending: true });

  if (targetsError) {
    console.error("Chargement des cibles impossible :", targetsError);

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
  const parsed = actionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Les informations transmises sont invalides." },
      { status: 400 }
    );
  }

  const { code, targetPlayerId } = parsed.data;
  const context = await authenticateSeer(code);

  if (!context.ok) {
    return context.response;
  }

  const { admin, game, player } = context;

  if (game.status !== "night_seer_action") {
    return NextResponse.json(
      { error: "La phase de la Voyante n'est plus active." },
      { status: 409 }
    );
  }

  const { data, error } = await admin.rpc("submit_seer_action", {
    p_game_id: game.id,
    p_player_id: player.id,
    p_target_player_id: targetPlayerId,
  });

  if (error) {
    console.error("Action de la Voyante impossible :", error);

    return NextResponse.json(
      { error: error.message || "Impossible d'enregistrer cette action." },
      { status: 400 }
    );
  }

  const result = data as SeerRpcResult | null;

  if (
    !result?.success ||
    !result.target_role_key ||
    !result.inspected_player_name
  ) {
    return NextResponse.json(
      { error: "La fonction SQL n'a pas retourné un résultat valide." },
      { status: 500 }
    );
  }

  // Le résultat du rôle n'est renvoyé qu'à la session authentifiée
  // de la Voyante qui vient d'effectuer l'action.
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("display_name, camp, description")
    .eq("role_key", result.target_role_key)
    .maybeSingle();

  if (roleError) {
    console.error("Lecture du résultat de la Voyante impossible :", roleError);

    return NextResponse.json(
      { error: "L'action est enregistrée, mais le rôle n'a pas pu être affiché." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    inspectedPlayer: {
      displayName: result.inspected_player_name,
    },
    revealedRole: {
      key: result.target_role_key,
      displayName: role?.display_name ?? result.target_role_key,
      camp: role?.camp ?? "Inconnu",
      description: role?.description ?? null,
    },
    nextPhase: result.next_phase,
  });
}
