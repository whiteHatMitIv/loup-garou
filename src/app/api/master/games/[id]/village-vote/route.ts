
import { NextResponse } from "next/server";
import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

type VoteRow = {
  voter_player_id: string;
  target_player_id: string | null;
};

type PlayerRow = {
  id: string;
  display_name: string;
  life_status: string | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const master = await getMasterUser();

    if (!master) {
      return NextResponse.json(
        { error: "Authentification requise." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const admin = createAdminClient();

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, name, status, round_number")
      .eq("id", id)
      .eq("master_id", master.id)
      .maybeSingle();

    if (gameError || !game) {
      return NextResponse.json(
        { error: gameError?.message ?? "Partie introuvable." },
        { status: gameError ? 500 : 404 }
      );
    }

    const { data: phase, error: phaseError } = await admin
      .from("game_phases")
      .select("id, phase_key, status, metadata, phase_number")
      .eq("game_id", id)
      .in("phase_key", ["village_vote_1", "village_vote_2"])
      .eq("day_number", Math.max(game.round_number, 1))
      .in("status", ["open", "closed", "resolved"])
      .order("phase_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (phaseError) {
      console.error("Lecture du scrutin impossible :", phaseError);

      return NextResponse.json(
        { error: "Impossible de charger le scrutin." },
        { status: 500 }
      );
    }

    const { data: playerData, error: playersError } = await admin
      .from("game_players")
      .select("id, display_name, life_status")
      .eq("game_id", id)
      .eq("registration_status", "approved")
      .order("display_name", { ascending: true });

    if (playersError) {
      return NextResponse.json(
        { error: "Impossible de charger les joueurs." },
        { status: 500 }
      );
    }

    const alivePlayers = (playerData ?? []) as PlayerRow[];
    const alivePlayerCount = alivePlayers.filter(
      (player) => player.life_status === "alive"
    ).length;
    let votes: VoteRow[] = [];

    if (phase) {
      const { data: voteData, error: votesError } = await admin
        .from("votes")
        .select("voter_player_id, target_player_id")
        .eq("game_id", id)
        .eq("phase_id", phase.id)
        .eq("vote_kind", "village");

      if (votesError) {
        console.error("Lecture des votes impossible :", votesError);

        return NextResponse.json(
          { error: "Impossible de charger les votes." },
          { status: 500 }
        );
      }

      votes = (voteData ?? []) as VoteRow[];
    }

    const voteCounts = new Map<string, number>();

    for (const vote of votes) {
      if (!vote.target_player_id) continue;

      voteCounts.set(
        vote.target_player_id,
        (voteCounts.get(vote.target_player_id) ?? 0) + 1
      );
    }

    let eligibleIds = alivePlayers.map((player) => player.id);

    if (phase?.phase_key === "village_vote_2") {
      const metadata = phase.metadata as {
        eligible_target_ids?: string[];
      } | null;

      eligibleIds = metadata?.eligible_target_ids ?? [];
    }

    const playersById = new Map(
      alivePlayers.map((player) => [player.id, player])
    );

    const tally = eligibleIds
      .map((playerId) => {
        const player = playersById.get(playerId);

        if (!player) return null;

        return {
          targetPlayerId: player.id,
          targetName: player.display_name,
          votes: voteCounts.get(player.id) ?? 0,
        };
      })
      .filter((item) => item !== null)
      .sort(
        (a, b) =>
          b.votes - a.votes ||
          a.targetName.localeCompare(b.targetName, "fr")
      );

    const voteDetails = votes
      .map((vote) => ({
        voterName:
          playersById.get(vote.voter_player_id)?.display_name ??
          "Joueur inconnu",
        targetName: vote.target_player_id
          ? playersById.get(vote.target_player_id)?.display_name ??
            "Joueur inconnu"
          : null,
        voterPlayerId: vote.voter_player_id,
      }))
      .sort((a, b) => a.voterName.localeCompare(b.voterName, "fr"));

    return NextResponse.json({
      game: {
        id: game.id,
        name: game.name,
        status: game.status,
        roundNumber: game.round_number,
      },
      phase: phase
        ? {
            id: phase.id,
            key: phase.phase_key,
            status: phase.status,
          }
        : null,
      alivePlayers: alivePlayerCount,
      totalVotes: votes.length,
      tally,
      voteDetails,
    });
  } catch (error) {
    console.error("Erreur du dashboard de vote :", error);

    return NextResponse.json(
      { error: "Une erreur inattendue est survenue." },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const master = await getMasterUser();

    if (!master) {
      return NextResponse.json(
        { error: "Authentification requise." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const admin = createAdminClient();

    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, status")
      .eq("id", id)
      .eq("master_id", master.id)
      .maybeSingle();

    if (gameError || !game) {
      return NextResponse.json(
        { error: gameError?.message ?? "Partie introuvable." },
        { status: gameError ? 500 : 404 }
      );
    }

    if (game.status === "day_discussion") {
      const { data, error } = await admin.rpc("start_village_vote", {
        p_game_id: id,
        p_master_id: master.id,
      });

      if (error) {
        console.error("Ouverture du scrutin impossible :", error);

        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        result: data,
        message: "Le premier scrutin du village est ouvert.",
      });
    }

    if (
      game.status === "village_vote_1" ||
      game.status === "village_vote_2"
    ) {
      const { data, error } = await admin.rpc("resolve_village_vote", {
        p_game_id: id,
        p_master_id: master.id,
      });

      if (error) {
        console.error("Clôture du scrutin impossible :", error);

        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        result: data,
        message:
          data?.next_phase === "village_vote_2"
            ? "Égalité : le second scrutin est ouvert."
            : "Le scrutin est terminé. La résolution de l'élimination est la prochaine étape.",
      });
    }

    return NextResponse.json(
      { error: "Aucune action de vote n'est disponible à cette phase." },
      { status: 409 }
    );
  } catch (error) {
    console.error("Action du maître impossible :", error);

    return NextResponse.json(
      { error: "Une erreur inattendue est survenue." },
      { status: 500 }
    );
  }
}
