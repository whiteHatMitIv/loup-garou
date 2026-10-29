
import { NextResponse } from "next/server";
import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

type PlayerRow = {
  id: string;
  display_name: string;
  registration_status: string;
  life_status: string | null;
  created_at: string;
};

type AssignmentRow = {
  player_id: string;
  role_key: string;
};

type RoleRow = {
  role_key: string;
  display_name: string;
  camp: string;
  description: string | null;
};

type ScoreEventRow = {
  player_id: string;
  points: number;
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

    // Vérifier que la partie appartient au maître connecté.
    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, name, status, round_number, invite_code")
      .eq("id", id)
      .eq("master_id", master.id)
      .maybeSingle();

    if (gameError) {
      console.error("Erreur de chargement du jeu :", gameError);

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

    // Récupérer les joueurs de la partie.
    const { data: playerData, error: playersError } = await admin
      .from("game_players")
      .select(
        "id, display_name, registration_status, life_status, created_at"
      )
      .eq("game_id", id)
      .order("created_at", { ascending: true });

    if (playersError) {
      console.error("Erreur de chargement des joueurs :", playersError);

      return NextResponse.json(
        { error: "Impossible de charger les joueurs." },
        { status: 500 }
      );
    }

    const players = (playerData ?? []) as PlayerRow[];

    // Récupérer les rôles attribués à cette partie.
    const { data: assignmentData, error: assignmentsError } = await admin
      .from("player_roles")
      .select("player_id, role_key")
      .eq("game_id", id);

    if (assignmentsError) {
      console.error(
        "Erreur de chargement des rôles attribués :",
        assignmentsError
      );

      return NextResponse.json(
        { error: "Impossible de charger les rôles attribués." },
        { status: 500 }
      );
    }

    const assignments = (assignmentData ?? []) as AssignmentRow[];

    const roleKeys = [
      ...new Set(assignments.map((assignment) => assignment.role_key)),
    ];

    let roles: RoleRow[] = [];

    // IMPORTANT : la colonne de correspondance est role_key,
    // aussi bien dans player_roles que dans roles.
    if (roleKeys.length > 0) {
      const { data: roleData, error: rolesError } = await admin
        .from("roles")
        .select("role_key, display_name, camp, description")
        .in("role_key", roleKeys);

      if (rolesError) {
        console.error(
          "Erreur de chargement des définitions des rôles :",
          rolesError
        );

        return NextResponse.json(
          { error: "Impossible de charger les définitions des rôles." },
          { status: 500 }
        );
      }

      roles = (roleData ?? []) as RoleRow[];
    }

    // Associer chaque définition de rôle à sa clé.
    const rolesByKey = new Map(
      roles.map((role) => [role.role_key, role])
    );

    // Associer ensuite chaque rôle à son joueur.
    const assignmentsByPlayer = new Map<string, RoleRow | null>();

    for (const assignment of assignments) {
      assignmentsByPlayer.set(
        assignment.player_id,
        rolesByKey.get(assignment.role_key) ?? null
      );
    }

    // Récupérer les points déjà enregistrés pour cette partie.
    const { data: scoreData, error: scoresError } = await admin
      .from("score_events")
      .select("player_id, points")
      .eq("game_id", id);

    if (scoresError) {
      console.error("Erreur de chargement des scores :", scoresError);

      return NextResponse.json(
        { error: "Impossible de charger les scores." },
        { status: 500 }
      );
    }

    const scoreEvents = (scoreData ?? []) as ScoreEventRow[];
    const scoresByPlayer = new Map<string, number>();

    for (const event of scoreEvents) {
      scoresByPlayer.set(
        event.player_id,
        (scoresByPlayer.get(event.player_id) ?? 0) +
          Number(event.points)
      );
    }

    // Construire la liste des joueurs avec leur rôle et leurs points.
    const enrichedPlayers = players.map((player) => ({
      id: player.id,
      displayName: player.display_name,
      registrationStatus: player.registration_status,
      lifeStatus: player.life_status,
      role: assignmentsByPlayer.get(player.id) ?? null,
      points: scoresByPlayer.get(player.id) ?? 0,
      createdAt: player.created_at,
    }));

    // Classement de cette partie : points décroissants,
    // puis prénoms par ordre alphabétique en cas d'égalité.
    const ranking = enrichedPlayers
      .filter((player) => player.registrationStatus === "approved")
      .map((player) => ({
        id: player.id,
        displayName: player.displayName,
        role: player.role?.display_name ?? null,
        points: player.points,
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

    return NextResponse.json({
      game,
      players: enrichedPlayers,
      ranking,
    });
  } catch (error) {
    console.error(
      "Erreur inattendue dans l'aperçu de la partie :",
      error
    );

    return NextResponse.json(
      { error: "Une erreur inattendue est survenue." },
      { status: 500 }
    );
  }
}
