import "server-only";

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

const createGameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Le nom de la partie est obligatoire.")
    .max(80, "Le nom ne doit pas dépasser 80 caractères."),
});

function createInviteCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

function getUnexpectedError() {
  return NextResponse.json(
    { error: "Une erreur serveur est survenue." },
    { status: 500 }
  );
}

// Liste uniquement les parties du maître connecté.
export async function GET() {
  try {
    const master = await getMasterUser();

    if (!master) {
      return NextResponse.json(
        { error: "Accès réservé au maître du jeu." },
        { status: 401 }
      );
    }

    const admin = createAdminClient();

    const { data, error } = await admin
      .from("games")
      .select(
        "id, name, invite_code, status, round_number, created_at, started_at, ended_at"
      )
      .eq("master_id", master.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erreur de lecture des parties:", error.message);
      return getUnexpectedError();
    }

    return NextResponse.json({ games: data });
  } catch (error) {
    console.error("Erreur GET /api/games:", error);
    return getUnexpectedError();
  }
}

// Crée une partie au nom du maître authentifié.
export async function POST(request: Request) {
  try {
    const master = await getMasterUser();

    if (!master) {
      return NextResponse.json(
        { error: "Accès réservé au maître du jeu." },
        { status: 401 }
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Le contenu envoyé est invalide." },
        { status: 400 }
      );
    }

    const parsed = createGameSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Nom invalide." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // En cas de collision du code unique, on réessaie.
    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = createInviteCode();

      const { data, error } = await admin
        .from("games")
        .insert({
          master_id: master.id,
          name: parsed.data.name,
          invite_code: inviteCode,
          status: "lobby",
          round_number: 0,
          config: {},
        })
        .select(
          "id, name, invite_code, status, round_number, created_at, started_at, ended_at"
        )
        .single();

      if (!error && data) {
        return NextResponse.json({ game: data }, { status: 201 });
      }

      if (error?.code === "23505") {
        continue;
      }

      console.error("Erreur de création de partie:", error?.message);
      return getUnexpectedError();
    }

    return NextResponse.json(
      { error: "Impossible de générer un code unique. Réessaie." },
      { status: 503 }
    );
  } catch (error) {
    console.error("Erreur POST /api/games:", error);
    return getUnexpectedError();
  }
}