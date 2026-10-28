import { NextResponse } from "next/server";
import { z } from "zod";

import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

const startGameSchema = z.object({
  roleCounts: z.object({
    villageois: z.number().int().min(0).max(100),
    loup_garou: z.number().int().min(0).max(100),
    voyante: z.number().int().min(0).max(1),
    sorciere: z.number().int().min(0).max(1),
    chasseur: z.number().int().min(0).max(1),
    cupidon: z.number().int().min(0).max(1),
  }).strict(),
});

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const master = await getMasterUser();

    if (!master) {
      return json({ error: "Accès réservé au maître du jeu." }, 401);
    }

    const { id } = await context.params;

    if (!z.string().uuid().safeParse(id).success) {
      return json({ error: "Identifiant de partie invalide." }, 400);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Requête invalide." }, 400);
    }

    const parsed = startGameSchema.safeParse(body);

    if (!parsed.success) {
      return json(
        {
          error:
            parsed.error.issues[0]?.message ??
            "La composition des rôles est invalide.",
        },
        400
      );
    }

    const admin = createAdminClient();

    const { data, error } = await admin.rpc("start_game", {
      p_game_id: id,
      p_master_id: master.id,
      p_role_counts: parsed.data.roleCounts,
    });

    if (error) {
      console.error("Erreur de lancement:", error.message);

      const message = error.message.toLowerCase();

      if (message.includes("not found or not owned")) {
        return json({ error: "Partie introuvable." }, 404);
      }

      if (message.includes("not in lobby")) {
        return json(
          { error: "Cette partie a déjà été lancée ou n'est plus ouverte." },
          409
        );
      }

      if (
        message.includes("approved player count") ||
        message.includes("approved players") ||
        message.includes("at least one") ||
        message.includes("role counts") ||
        message.includes("maximum one") ||
        message.includes("at least two") ||
        message.includes("unknown role") ||
        message.includes("integer")
      ) {
        return json(
          {
            error:
              "La composition des rôles est incompatible avec les joueurs validés. Vérifie les effectifs.",
          },
          400
        );
      }

      return json(
        { error: "Le lancement a échoué. Consulte le terminal du serveur." },
        500
      );
    }

    return json({ success: true, result: data }, 200);
  } catch (error) {
    console.error("Erreur POST start game:", error);

    return json({ error: "Une erreur serveur est survenue." }, 500);
  }
}