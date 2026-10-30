import { NextResponse } from "next/server";

import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

type PlayerRow = {
  id: string;
  display_name: string;
  life_status: string;
};

type AssignmentRow = {
  player_id: string;
  role_key: string;
};

type RoleRow = {
  role_key: string;
  display_name: string;
};

type ScoreRow = {
  player_id: string;
  points: number;
};

type DeathRow = {
  player_id: string;
  death_cause: string;
  resolution_order: number;
  created_at: string;
};

const deathCauseLabels: Record<string, string> = {
  wolf_attack: "Victime des Loups-Garous",
  witch_potion: "Potion de mort de la Sorcière",
  hunter_shot: "Tir du Chasseur",
  lover_chain: "Lien amoureux",
  village_vote: "Vote du village",
  other: "Autre cause",
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
      .select("id, name, master_id, status, winner, started_at, ended_at")
      .eq("id", id)
      .eq("master_id", master.id)
      .maybeSingle();

    if (gameError) {
      console.error("Chargement de la partie impossible :", gameError);

      return NextResponse.json(
        { error: "Impossible de charger cette partie." },
        { status: 500 }
      );
    }

    if (!game) {
      return NextResponse.json(
        { error: "Partie introuvable ou accès refusé." },
        { status: 404 }
      );
    }

    if (!["game_over", "finished"].includes(game.status)) {
      return NextResponse.json(
        {
          error:
            "Le bilan final ne peut être généré qu'une fois la partie terminée.",
        },
        { status: 409 }
      );
    }

    const { data: playerData, error: playersError } = await admin
      .from("game_players")
      .select("id, display_name, life_status")
      .eq("game_id", id)
      .eq("registration_status", "approved");

    if (playersError) {
      console.error("Chargement des joueurs impossible :", playersError);

      return NextResponse.json(
        { error: "Impossible de charger les joueurs." },
        { status: 500 }
      );
    }

    const players = (playerData ?? []) as PlayerRow[];
    const playerIds = players.map((player) => player.id);

    let assignments: AssignmentRow[] = [];
    let scores: ScoreRow[] = [];
    let deaths: DeathRow[] = [];

    if (playerIds.length > 0) {
      const { data, error } = await admin
        .from("player_roles")
        .select("player_id, role_key")
        .eq("game_id", id)
        .in("player_id", playerIds);

      if (error) {
        console.error("Chargement des rôles impossible :", error);

        return NextResponse.json(
          { error: "Impossible de charger les rôles." },
          { status: 500 }
        );
      }

      assignments = (data ?? []) as AssignmentRow[];
    }

    const { data: scoreData, error: scoresError } = await admin
      .from("score_events")
      .select("player_id, points")
      .eq("game_id", id);

    if (scoresError) {
      console.error("Chargement des scores impossible :", scoresError);

      return NextResponse.json(
        { error: "Impossible de charger les scores." },
        { status: 500 }
      );
    }

    scores = (scoreData ?? []) as ScoreRow[];

    const { data: deathData, error: deathsError } = await admin
      .from("deaths")
      .select("player_id, death_cause, resolution_order, created_at")
      .eq("game_id", id)
      .order("created_at", { ascending: true })
      .order("resolution_order", { ascending: true });

    if (deathsError) {
      console.error("Chargement des éliminations impossible :", deathsError);

      return NextResponse.json(
        { error: "Impossible de charger les éliminations." },
        { status: 500 }
      );
    }

    deaths = (deathData ?? []) as DeathRow[];

    const roleKeys = [
      ...new Set(assignments.map((assignment) => assignment.role_key)),
    ];

    let roles: RoleRow[] = [];

    if (roleKeys.length > 0) {
      const { data, error } = await admin
        .from("roles")
        .select("role_key, display_name")
        .in("role_key", roleKeys);

      if (error) {
        console.error("Lecture des définitions de rôles impossible :", error);

        return NextResponse.json(
          { error: "Impossible de charger les définitions des rôles." },
          { status: 500 }
        );
      }

      roles = (data ?? []) as RoleRow[];
    }

    const playersById = new Map(
      players.map((player) => [player.id, player])
    );

    const rolesByKey = new Map(
      roles.map((role) => [role.role_key, role.display_name])
    );

    const roleByPlayer = new Map<string, string>();

    for (const assignment of assignments) {
      roleByPlayer.set(
        assignment.player_id,
        rolesByKey.get(assignment.role_key) ?? assignment.role_key
      );
    }

    const scoresByPlayer = new Map<string, number>();

    for (const score of scores) {
      scoresByPlayer.set(
        score.player_id,
        (scoresByPlayer.get(score.player_id) ?? 0) + Number(score.points)
      );
    }

    const ranking = players
      .map((player) => ({
        id: player.id,
        displayName: player.display_name,
        role: roleByPlayer.get(player.id) ?? "Rôle inconnu",
        lifeStatus: player.life_status,
        points: scoresByPlayer.get(player.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          a.displayName.localeCompare(b.displayName, "fr")
      )
      .map((player, index) => ({
        ...player,
        rank: index + 1,
      }));

    const winnerLabel =
      game.winner === "village"
        ? "Le Village"
        : game.winner === "loups"
          ? "Les Loups-Garous"
          : game.winner ?? "Non déterminé";

    const rankingText = ranking.length
      ? ranking
          .map(
            (player) =>
              `${player.rank}. ${player.displayName} — ${player.role} — ${player.points} point(s)`
          )
          .join("\n")
      : "Aucun joueur validé.";

    const deathsText = deaths.length
      ? deaths
          .map((death) => {
            const player = playersById.get(death.player_id);
            const name = player?.display_name ?? "Joueur inconnu";
            const cause =
              deathCauseLabels[death.death_cause] ??
              death.death_cause.replaceAll("_", " ");

            return `• ${name} — ${cause}`;
          })
          .join("\n")
      : "Aucune élimination enregistrée.";

    const aliveCount = ranking.filter(
      (player) => player.lifeStatus === "alive"
    ).length;

    const shareText = [
      "🌙 NOCTURNE — BILAN FINAL",
      "",
      `🎮 Partie : ${game.name}`,
      `🏆 Camp vainqueur : ${winnerLabel}`,
      `👥 Joueurs : ${ranking.length}`,
      `🟢 Survivants : ${aliveCount}`,
      "",
      "🏅 CLASSEMENT FINAL",
      rankingText,
      "",
      "⚰️ ÉLIMINATIONS",
      deathsText,
      "",
      "Merci à tous pour la partie !",
    ].join("\n");

    return NextResponse.json({
      game: {
        id: game.id,
        name: game.name,
        status: game.status,
        winner: game.winner,
        startedAt: game.started_at,
        endedAt: game.ended_at,
      },
      ranking,
      deaths: deaths.map((death) => ({
        playerName:
          playersById.get(death.player_id)?.display_name ??
          "Joueur inconnu",
        cause:
          deathCauseLabels[death.death_cause] ??
          death.death_cause.replaceAll("_", " "),
        resolutionOrder: death.resolution_order,
      })),
      shareText,
    });
  } catch (error) {
    console.error("Génération du bilan impossible :", error);

    return NextResponse.json(
      { error: "Une erreur inattendue est survenue." },
      { status: 500 }
    );
  }
}