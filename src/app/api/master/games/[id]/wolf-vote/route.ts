import { NextResponse } from "next/server";
import { z } from "zod";

import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const uuidSchema = z.string().uuid();

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext
) {
  try {
    const master = await getMasterUser();

    if (!master) {
      return json({ error: "Accès réservé au maître du jeu." }, 401);
    }

    const { id } = await context.params;

    if (!uuidSchema.safeParse(id).success) {
      return json({ error: "Identifiant invalide." }, 400);
    }

    const admin = createAdminClient();

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, name, status")
      .eq("id", id)
      .eq("master_id", master.id)
      .maybeSingle();

    if (gameError) {
      console.error("Lecture de la partie impossible:", gameError.message);
      return json({ error: "Impossible de charger la partie." }, 500);
    }

    if (!game) {
      return json({ error: "Partie introuvable." }, 404);
    }

    const { data: phase, error: phaseError } = await admin
      .from("game_phases")
      .select("id, phase_number, status")
      .eq("game_id", id)
      .eq("phase_key", "night_wolf_vote")
      .eq("status", "open")
      .order("phase_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (phaseError) {
      console.error("Lecture de la phase impossible:", phaseError.message);
      return json({ error: "Impossible de charger le scrutin." }, 500);
    }

    if (!phase) {
      return json({
        gameStatus: game.status,
        phase: null,
        aliveWolves: 0,
        submittedVotes: 0,
        pendingVotes: 0,
        tally: [],
      });
    }

    const { data: wolfRoles, error: rolesError } = await admin
      .from("player_roles")
      .select("player_id")
      .eq("game_id", id)
      .eq("role_key", "loup_garou");

    if (rolesError) {
      console.error("Lecture des Loups impossible:", rolesError.message);
      return json({ error: "Impossible de charger les rôles." }, 500);
    }

    const wolfIds = (wolfRoles ?? []).map((role) => role.player_id);

    let aliveWolfIds: string[] = [];

    if (wolfIds.length > 0) {
      const { data: livingWolves, error: livingError } = await admin
        .from("game_players")
        .select("id")
        .eq("game_id", id)
        .eq("registration_status", "approved")
        .eq("life_status", "alive")
        .in("id", wolfIds);

      if (livingError) {
        console.error("Lecture des Loups vivants impossible:", livingError.message);
        return json({ error: "Impossible de charger les joueurs vivants." }, 500);
      }

      aliveWolfIds = (livingWolves ?? []).map((wolf) => wolf.id);
    }

    const { data: votes, error: votesError } = await admin
      .from("votes")
      .select("voter_player_id, target_player_id")
      .eq("game_id", id)
      .eq("phase_id", phase.id)
      .eq("vote_kind", "wolves")
      .not("target_player_id", "is", null);

    if (votesError) {
      console.error("Lecture des votes impossible:", votesError.message);
      return json({ error: "Impossible de charger les votes." }, 500);
    }

    const aliveWolfSet = new Set(aliveWolfIds);
    const validVotes = (votes ?? []).filter(
      (vote) =>
        aliveWolfSet.has(vote.voter_player_id) &&
        vote.target_player_id !== null
    );

    const targetIds = [
      ...new Set(
        validVotes
          .map((vote) => vote.target_player_id)
          .filter((targetId): targetId is string => targetId !== null)
      ),
    ];

    let targetPlayers: {
      id: string;
      display_name: string;
      normalized_name: string;
    }[] = [];

    if (targetIds.length > 0) {
      const { data: targets, error: targetsError } = await admin
        .from("game_players")
        .select("id, display_name, normalized_name")
        .eq("game_id", id)
        .in("id", targetIds);

      if (targetsError) {
        console.error("Lecture des cibles impossible:", targetsError.message);
        return json({ error: "Impossible de charger les cibles." }, 500);
      }

      targetPlayers = targets ?? [];
    }

    const targetMap = new Map(
      targetPlayers.map((target) => [target.id, target])
    );

    const tallyMap = new Map<string, number>();

    for (const vote of validVotes) {
      const targetId = vote.target_player_id;

      if (targetId && targetMap.has(targetId)) {
        tallyMap.set(targetId, (tallyMap.get(targetId) ?? 0) + 1);
      }
    }

    const tally = [...tallyMap.entries()]
      .map(([id, votes]) => {
        const target = targetMap.get(id)!;

        return {
          id,
          displayName: target.display_name,
          votes,
          normalizedName: target.normalized_name,
        };
      })
      .sort(
        (a, b) =>
          b.votes - a.votes ||
          a.normalizedName.localeCompare(b.normalizedName, "fr") ||
          a.id.localeCompare(b.id)
      )
      .map(({ id, displayName, votes }) => ({
        id,
        displayName,
        votes,
      }));

    return json({
      gameStatus: game.status,
      phase: {
        id: phase.id,
        number: phase.phase_number,
      },
      aliveWolves: aliveWolfIds.length,
      submittedVotes: validVotes.length,
      pendingVotes: Math.max(0, aliveWolfIds.length - validVotes.length),
      tally,
    });
  } catch (error) {
    console.error("Erreur GET vote des Loups:", error);
    return json({ error: "Une erreur serveur est survenue." }, 500);
  }
}

export async function POST(
  _request: Request,
  context: RouteContext
) {
  try {
    const master = await getMasterUser();

    if (!master) {
      return json({ error: "Accès réservé au maître du jeu." }, 401);
    }

    const { id } = await context.params;

    if (!uuidSchema.safeParse(id).success) {
      return json({ error: "Identifiant invalide." }, 400);
    }

    const admin = createAdminClient();

    const { data, error } = await admin.rpc("resolve_wolf_vote", {
      p_game_id: id,
      p_master_id: master.id,
    });

    if (error) {
      console.error("Clôture du vote impossible:", error.message);

      if (
        error.message.includes("not owned") ||
        error.message.includes("Game not found")
      ) {
        return json({ error: "Partie introuvable." }, 404);
      }

      if (
        error.message.includes("not in the wolf vote phase") ||
        error.message.includes("No open wolf vote phase")
      ) {
        return json({ error: "Ce scrutin est déjà clôturé." }, 409);
      }

      return json({ error: "Impossible de clôturer le scrutin." }, 500);
    }

    return json({ success: true, result: data });
  } catch (error) {
    console.error("Erreur POST clôture des Loups:", error);
    return json({ error: "Une erreur serveur est survenue." }, 500);
  }
}