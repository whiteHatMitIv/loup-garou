import { NextResponse } from "next/server";
import { z } from "zod";

import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Liste les inscriptions en attente pour les parties du maître connecté.
export async function GET() {
  try {
    const master = await getMasterUser();

    if (!master) {
      return response({ error: "Accès non autorisé." }, 401);
    }

    const admin = createAdminClient();

    const { data: games, error: gamesError } = await admin
      .from("games")
      .select("id, name")
      .eq("master_id", master.id)
      .eq("status", "lobby");

    if (gamesError) {
      console.error("Lecture des parties impossible:", gamesError.message);
      return response({ error: "Impossible de charger les inscriptions." }, 500);
    }

    if (!games?.length) {
      return response({ registrations: [] });
    }

    const gameIds = games.map((game) => game.id);
    const gameNames = new Map(games.map((game) => [game.id, game.name]));

    const { data: players, error: playersError } = await admin
      .from("game_players")
      .select("id, game_id, display_name, joined_at")
      .in("game_id", gameIds)
      .eq("registration_status", "pending")
      .order("joined_at", { ascending: true });

    if (playersError) {
      console.error(
        "Lecture des demandes impossible:",
        playersError.message
      );

      return response({ error: "Impossible de charger les demandes." }, 500);
    }

    const registrations = (players ?? []).map((player) => ({
      id: player.id,
      gameId: player.game_id,
      gameName: gameNames.get(player.game_id) ?? "Partie",
      displayName: player.display_name,
      joinedAt: player.joined_at,
    }));

    return response({ registrations });
  } catch (error) {
    console.error("Erreur GET /api/master/registrations:", error);
    return response({ error: "Une erreur serveur est survenue." }, 500);
  }
}

const decisionSchema = z.object({
  playerId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});

// Accepte ou refuse une demande d'inscription.
export async function POST(request: Request) {
  try {
    const master = await getMasterUser();

    if (!master) {
      return response({ error: "Accès non autorisé." }, 401);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return response({ error: "Données invalides." }, 400);
    }

    const parsed = decisionSchema.safeParse(body);

    if (!parsed.success) {
      return response({ error: "Décision invalide." }, 400);
    }

    const { playerId, decision } = parsed.data;
    const admin = createAdminClient();

    const { data: player, error: playerError } = await admin
      .from("game_players")
      .select("id, game_id, registration_status")
      .eq("id", playerId)
      .maybeSingle();

    if (playerError) {
      console.error("Recherche du joueur impossible:", playerError.message);
      return response({ error: "Impossible de retrouver ce joueur." }, 500);
    }

    if (!player || player.registration_status !== "pending") {
      return response(
        { error: "Cette demande n'est plus en attente." },
        409
      );
    }

    // Vérifie que la partie appartient au maître et que les inscriptions
    // sont encore ouvertes.
    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id")
      .eq("id", player.game_id)
      .eq("master_id", master.id)
      .eq("status", "lobby")
      .maybeSingle();

    if (gameError) {
      console.error("Vérification de la partie impossible:", gameError.message);
      return response({ error: "Impossible de vérifier la partie." }, 500);
    }

    if (!game) {
      return response(
        { error: "Tu ne peux plus traiter les inscriptions de cette partie." },
        409
      );
    }

    const update =
      decision === "approve"
        ? {
            registration_status: "approved",
            approved_by: master.id,
            approved_at: new Date().toISOString(),
          }
        : {
            registration_status: "rejected",
            approved_by: null,
            approved_at: null,
            // Libère le nom normalisé pour permettre une nouvelle demande.
            normalized_name: `rejected_${player.id.replaceAll("-", "")}`,
          };

    const { data: updated, error: updateError } = await admin
      .from("game_players")
      .update(update)
      .eq("id", player.id)
      .eq("registration_status", "pending")
      .select("id, registration_status")
      .maybeSingle();

    if (updateError) {
      console.error("Mise à jour impossible:", updateError.message);
      return response({ error: "Impossible d'enregistrer la décision." }, 500);
    }

    if (!updated) {
      return response(
        { error: "La demande a déjà été traitée." },
        409
      );
    }

    return response({
      success: true,
      playerId: updated.id,
      registrationStatus: updated.registration_status,
    });
  } catch (error) {
    console.error("Erreur POST /api/master/registrations:", error);
    return response({ error: "Une erreur serveur est survenue." }, 500);
  }
}