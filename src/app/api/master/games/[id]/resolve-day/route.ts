
import { NextResponse } from "next/server";
import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

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

    if (game.status !== "day_resolution") {
      return NextResponse.json(
        { error: "La partie n'est pas en phase de résolution du vote." },
        { status: 409 }
      );
    }

    const { data, error } = await admin.rpc("resolve_day_vote", {
      p_game_id: game.id,
      p_master_id: master.id,
    });

    if (error) {
      console.error("Résolution du vote impossible :", error);

      return NextResponse.json(
        { error: error.message || "Impossible de résoudre le vote." },
        { status: 400 }
      );
    }

    let message = "Le vote a été résolu.";

    if (data?.requires_hunter_action) {
      message = "Le Chasseur doit choisir sa cible avant la suite.";
    } else if (data?.game_status === "game_over") {
      message = "La partie est terminée.";
    } else if (data?.game_status === "night_wolf_vote") {
      message = "L'élimination est résolue. La prochaine nuit commence.";
    }

    return NextResponse.json({
      success: true,
      result: data,
      message,
    });
  } catch (error) {
    console.error("Erreur de résolution du vote :", error);

    return NextResponse.json(
      { error: "Une erreur inattendue est survenue." },
      { status: 500 }
    );
  }
}
