"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Moon,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import CupidonAction from "./cupidon-action";

type PlayerRole = {
  key: string;
  displayName: string;
  camp: string;
  description: string;
};

type PlayerTarget = {
  id: string;
  display_name: string;
};

type JoinState = {
  game: {
    name: string;
    status: string;
  };
  player: {
    displayName: string;
    registrationStatus: string;
    lifeStatus: string;
    role?: PlayerRole | null;
  } | null;
  eligibleTargets?: PlayerTarget[];
};

type ApiResult = JoinState & {
  error?: string;
  message?: string;
};

const gameStatusLabels: Record<string, string> = {
  lobby: "Inscriptions ouvertes",
  role_distribution: "Distribution des rôles",
  cupidon_selection: "Préparation de la partie",
  night_wolf_vote: "Partie en cours",
  night_witch_action: "Partie en cours",
  night_seer_action: "Partie en cours",
  night_resolution: "Partie en cours",
  day_discussion: "Partie en cours",
  village_vote_1: "Partie en cours",
  village_vote_2: "Partie en cours",
  day_resolution: "Partie en cours",
  paused: "Partie en pause",
  game_over: "Partie terminée",
};

/** Astuces contextuelles par rôle (optionnel : si absent, rien ne s'affiche) */
const roleTips: Record<string, string> = {
  loup: "Chaque nuit, coordonne-toi avec les autres loups pour éliminer un villageois.",
  loup_garou:
    "Chaque nuit, coordonne-toi avec les autres loups pour éliminer un villageois.",
  voyante:
    "Chaque nuit, tu peux découvrir le rôle secret d'un joueur de ton choix.",
  sorciere:
    "Tu disposes de deux potions : une de vie pour sauver, une de mort pour tuer.",
  chasseur: "Si tu meurs, tu peux emporter un autre joueur dans ta chute.",
  cupidon:
    "La première nuit, désigne deux amoureux. Si l'un meurt, l'autre meurt aussi.",
  petite_fille:
    "Tu espionnes les loups la nuit, mais attention à ne pas te faire repérer.",
  salvateur:
    "Chaque nuit, protège un joueur des loups (pas deux fois le même d'affilée).",
  ancien: "Tu résistes à la première attaque des loups.",
  idiot_du_village:
    "Si le village vote contre toi, tu es révélé mais tu survis.",
  villageois:
    "Utilise ton vote et ta parole pour aider le village à démasquer les loups.",
};

export default function JoinGameForm({
  initialCode,
}: {
  initialCode: string;
}) {
  const [name, setName] = useState("");
  const [state, setState] = useState<JoinState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/join?code=${encodeURIComponent(initialCode)}`,
        { cache: "no-store" }
      );

      const result = (await response.json()) as ApiResult;

      if (!response.ok || !result.game) {
        setState(null);
        setError(result.error ?? "Impossible de charger cette partie.");
        return;
      }

      setState(result);
      if (result.player) {
        setName(result.player.displayName);
      }
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setLoading(false);
    }
  }, [initialCode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
  }, [loadStatus]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: initialCode,
          name,
        }),
      });

      const result = (await response.json()) as ApiResult;

      if (!response.ok) {
        setError(result.error ?? "Impossible de rejoindre cette partie.");
        return;
      }

      await loadStatus();
    } catch {
      setError("La demande a échoué. Vérifie ta connexion et réessaie.");
    } finally {
      setSubmitting(false);
    }
  }

  const canRegister =
    state?.game.status === "lobby" &&
    (!state.player || state.player.registrationStatus === "rejected");

  // L'intro "Rejoindre le village" ne s'affiche que si l'utilisateur peut encore s'inscrire
  const showJoinIntro = canRegister;

  // "Inscriptions fermées" uniquement pour un visiteur SANS fiche joueur
  const showClosedMessage =
    !!state && !state.player && state.game.status !== "lobby";

  // 🔑 Cupidon peut agir : il est approuvé, a le rôle cupidon, est en vie,
  //    et la partie est en phase de sélection des amoureux.
  const cupidonCanAct =
    state?.player?.registrationStatus === "approved" &&
    state?.player?.role?.key === "cupidon" &&
    state?.player?.lifeStatus !== "dead" &&
    state?.game.status === "cupidon_selection";

  return (
    <main className="auth-page join-page">
      <section className="auth-card">
        <Link href="/" className="brand auth-brand">
          <span className="brand-mark">
            <Moon />
          </span>
          <span>NOCTURNE</span>
        </Link>

        {loading ? (
          <div className="join-loading" role="status">
            <LoaderCircle className="auth-spinner" size={25} />
            <p>Recherche de la partie...</p>
          </div>
        ) : (
          <>
            {showJoinIntro && (
              <p className="section-kicker">REJOINDRE LE VILLAGE</p>
            )}

            {state ? (
              <>
                <h1 className="auth-title">{state.game.name}</h1>

                {showJoinIntro && (
                  <p className="auth-description">
                    Inscris-toi avec ton prénom. Le maître du jeu devra
                    valider ta demande avant que tu puisses participer.
                  </p>
                )}

                <div className="join-code-display">
                  <span>CODE DE LA PARTIE</span>
                  <strong>{initialCode}</strong>
                </div>

                <div className="join-game-status">
                  <span className="join-status-dot" />
                  {gameStatusLabels[state.game.status] ?? state.game.status}
                </div>

                {/* ── DEMANDE EN ATTENTE ─────────────────────────────── */}
                {state.player?.registrationStatus === "pending" && (
                  <div className="join-status-card pending" role="status">
                    <ShieldCheck size={21} />
                    <div>
                      <strong>Demande envoyée</strong>
                      <p>
                        Bonjour {state.player.displayName} ! Ta demande
                        est en attente de validation par le maître du jeu.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── RÔLE RÉVÉLÉ ─────────────────────────────────────── */}
                {state.player?.registrationStatus === "approved" &&
                  state.player.role && (
                    <>
                      <div className="player-identity">
                        <div className="player-identity-info mt-2">
                          <strong>{state.player.displayName} </strong>
                          <span>Tu joues dans cette partie</span>
                        </div>
                      </div>

                      <section className="player-role-card">
                        <div className="player-role-heading">
                          <span className="section-kicker">
                            TON RÔLE SECRET
                          </span>
                          <Moon size={21} aria-hidden="true" />
                        </div>

                        <h2>{state.player.role.displayName}</h2>

                        <span
                          className={`player-role-camp ${
                            state.player.role.camp === "loups"
                              ? "player-role-camp-wolves"
                              : "player-role-camp-village"
                          }`}
                        >
                          {state.player.role.camp === "loups"
                            ? "Camp des Loups"
                            : "Camp du village"}
                        </span>

                        {/* Astuce : masquée quand Cupidon peut agir
                            (le panneau d'action explique déjà) */}
                        {roleTips[state.player.role.key] &&
                          !cupidonCanAct && (
                            <div className="player-role-tip mt-2">
                              <span>
                                {roleTips[state.player.role.key]}
                              </span>
                            </div>
                          )}

                        <div className="player-role-status">
                          <CheckCircle2 size={17} />
                          <span>
                            {state.player.lifeStatus === "dead"
                              ? "Tu as été éliminé."
                              : "Tu es en vie."}
                          </span>
                        </div>
                      </section>

                      {/* 🔑 Action Cupidon (uniquement en phase cupidon_selection) */}
                      {cupidonCanAct && (
                        <CupidonAction
                          code={initialCode}
                          targets={(state.eligibleTargets ?? []).map(
                            (target) => ({
                              id: target.id,
                              displayName: target.display_name,
                            })
                          )}
                          onCompleted={loadStatus}
                        />
                      )}
                    </>
                  )}

                {/* ── INSCRIT, RÔLE PAS ENCORE DISTRIBUÉ (LOBBY) ─────── */}
                {state.player?.registrationStatus === "approved" &&
                  !state.player.role &&
                  state.game.status === "lobby" && (
                    <div className="join-status-card approved" role="status">
                      <CheckCircle2 size={21} />
                      <div>
                        <strong>Inscription validée</strong>
                        <p>
                          Bonjour {state.player.displayName} ! Tu es
                          inscrit à cette partie. Attends le lancement
                          pour découvrir ton rôle.
                        </p>
                      </div>
                    </div>
                  )}

                {/* ── PARTIE LANCÉE, RÔLE ENCORE INTROUVABLE ─────────── */}
                {state.player?.registrationStatus === "approved" &&
                  !state.player.role &&
                  state.game.status !== "lobby" && (
                    <div className="join-status-card pending" role="status">
                      <ShieldCheck size={21} />
                      <div>
                        <strong>Rôle en attente de récupération</strong>
                        <p>
                          La partie a commencé, mais ton rôle n&apos;a pas
                          encore été récupéré. Actualise la page ou
                          contacte le maître du jeu.
                        </p>
                      </div>
                    </div>
                  )}

                {/* ── DEMANDE REFUSÉE ────────────────────────────────── */}
                {state.player?.registrationStatus === "rejected" && (
                  <div className="join-status-card rejected" role="status">
                    <ShieldCheck size={21} />
                    <div>
                      <strong>Demande refusée</strong>
                      <p>
                        Contacte le maître du jeu si tu penses qu&apos;il
                        s&apos;agit d&apos;une erreur.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── FORMULAIRE D'INSCRIPTION ───────────────────────── */}
                {canRegister && (
                  <form className="auth-form" onSubmit={handleSubmit}>
                    <div className="form-field">
                      <label htmlFor="player-name">Ton prénom</label>
                      <input
                        id="player-name"
                        autoComplete="given-name"
                        maxLength={40}
                        placeholder="Ex. : Ivan"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                      />
                    </div>

                    {state.player?.registrationStatus === "rejected" && (
                      <p className="dashboard-muted">
                        Tu peux soumettre une nouvelle demande. Assure-toi
                        d&apos;utiliser le nom convenu avec le maître du
                        jeu.
                      </p>
                    )}

                    {error && (
                      <p className="auth-error" role="alert">
                        {error}
                      </p>
                    )}

                    <button
                      className="btn btn-primary auth-submit"
                      type="submit"
                      disabled={
                        submitting || state.game.status !== "lobby"
                      }
                    >
                      {submitting ? (
                        <>
                          <LoaderCircle className="auth-spinner" />
                          Envoi...
                        </>
                      ) : (
                        "Demander à rejoindre"
                      )}
                    </button>
                  </form>
                )}

                {showClosedMessage && (
                  <p className="join-closed-message">
                    Les inscriptions à cette partie ne sont plus ouvertes.
                  </p>
                )}
              </>
            ) : (
              <div className="join-error-panel">
                <h1 className="auth-title">Partie introuvable</h1>
                <p className="auth-description">
                  Vérifie le lien reçu dans WhatsApp, puis réessaie.
                </p>

                {error && (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}