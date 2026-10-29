
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

    const { data, error } = await admin.rpc("resolve_night", {
      p_game_id: id,
      p_master_id: master.id,
    });

    if (error) {
      console.error("Résolution de la nuit impossible :", error);

      return NextResponse.json(
        { error: error.message || "Impossible de résoudre la nuit." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      result: data,
      message: data?.requires_hunter_action
        ? "Le Chasseur doit maintenant choisir sa cible."
        : data?.game_status === "game_over"
          ? "La partie est terminée."
          : "La nuit est résolue. Le débat du village peut commencer.",
    });
  } catch (error) {
    console.error("Erreur inattendue de résolution :", error);

    return NextResponse.json(
      { error: "Une erreur inattendue est survenue." },
      { status: 500 }
    );
  }
}
