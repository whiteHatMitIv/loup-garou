"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Vote } from "lucide-react";

type VoteTarget = {
  targetPlayerId?: string;
  target_player_id?: string;
  targetName?: string;
  target_name?: string;
  displayName?: string;
  display_name?: string;
  name?: string;
  votes?: number;
  vote_count?: number;
  count?: number;
};

type VoteSummary = {
  phase?: {
    id?: string;
    status?: string;
  } | null;
  phaseStatus?: string;
  phase_status?: string;
  wolvesAlive?: number;
  wolves_alive?: number;
  aliveWolves?: number;
  alive_wolves?: number;
  votesReceived?: number;
  votes_received?: number;
  submittedVotes?: number;
  submitted_votes?: number;
  totalVotes?: number;
  tally?: VoteTarget[] | Record<string, number>;
  votesByTarget?: VoteTarget[] | Record<string, number>;
  votes_by_target?: VoteTarget[] | Record<string, number>;
  error?: string;
  message?: string;
};

type NormalizedTally = {
  name: string;
  votes: number;
};

function getNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function normalizeTally(summary: VoteSummary): NormalizedTally[] {
  const source =
    summary.tally ??
    summary.votesByTarget ??
    summary.votes_by_target ??
    [];

  if (Array.isArray(source)) {
    return source.map((item) => ({
      name:
        item.targetName ??
        item.target_name ??
        item.displayName ??
        item.display_name ??
        item.name ??
        item.targetPlayerId ??
        item.target_player_id ??
        "Cible inconnue",
      votes: getNumber(item.votes, item.vote_count, item.count),
    }));
  }

  return Object.entries(source).map(([name, votes]) => ({
    name,
    votes: getNumber(votes),
  }));
}

export default function WolfVoteControl({
  gameId,
}: {
  gameId: string;
}) {
  const router = useRouter();

  const [summary, setSummary] = useState<VoteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadVotes = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/master/games/${gameId}/wolf-vote`,
        { cache: "no-store" }
      );

      const result = (await response.json()) as VoteSummary;

      if (!response.ok) {
        throw new Error(
          result.error ?? "Impossible de charger les votes des Loups."
        );
      }

      setSummary(result);
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur est survenue pendant le chargement des votes."
      );
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVotes();

    const interval = window.setInterval(() => {
      void loadVotes();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [loadVotes]);

  async function closeVote() {
    const confirmed = window.confirm(
      "Clôturer le vote des Loups-Garous ? Cette action fera passer la partie à la phase suivante."
    );

    if (!confirmed) return;

    setClosing(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `/api/master/games/${gameId}/wolf-vote`,
        { method: "POST" }
      );

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(
          result.error ?? "Impossible de clôturer le vote."
        );
      }

      setSuccess(result.message ?? "Le vote a été clôturé.");
      await loadVotes();

      // Recharge les données serveur, dont le statut de la partie.
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur est survenue pendant la clôture du vote."
      );
    } finally {
      setClosing(false);
    }
  }

  const wolvesAlive = getNumber(
    summary?.wolvesAlive,
    summary?.wolves_alive,
    summary?.aliveWolves,
    summary?.alive_wolves
  );

  const votesReceived = getNumber(
    summary?.votesReceived,
    summary?.votes_received,
    summary?.submittedVotes,
    summary?.submitted_votes,
    summary?.totalVotes
  );

  const tally = summary ? normalizeTally(summary) : [];
  const phaseStatus =
    summary?.phase?.status ??
    summary?.phaseStatus ??
    summary?.phase_status;

  return (
    <section className="dashboard-panel wolf-vote-control">
      <p className="section-kicker">PHASE DE NUIT</p>

      <div className="wolf-vote-heading">
        <div>
          <h2>
            <Vote size={21} aria-hidden="true" />
            Vote des Loups-Garous
          </h2>

          <p className="role-setup-description">
            Consulte les votes reçus avant de clôturer le scrutin.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary wolf-vote-refresh"
          onClick={() => void loadVotes()}
          disabled={loading || closing}
        >
          <RefreshCw size={16} />
          Actualiser
        </button>
      </div>

      <div className="wolf-vote-stats">
        <div className="wolf-vote-stat">
          <span>Loups en vie</span>
          <strong>{loading ? "…" : wolvesAlive}</strong>
        </div>

        <div className="wolf-vote-stat">
          <span>Votes reçus</span>
          <strong>{loading ? "…" : votesReceived}</strong>
        </div>
      </div>

      <div className="wolf-vote-tally">
        <h3>Voix par cible</h3>

        {loading && (
          <p className="dashboard-muted">
            Chargement des résultats…
          </p>
        )}

        {!loading && tally.length === 0 && (
          <p className="dashboard-muted">
            Aucun vote enregistré pour le moment.
          </p>
        )}

        {!loading &&
          tally.map((target, index) => (
            <div className="wolf-vote-target" key={`${target.name}-${index}`}>
              <span>{target.name}</span>
              <strong>
                {target.votes}{" "}
                {target.votes > 1 ? "voix" : "voix"}
              </strong>
            </div>
          ))}
      </div>

      {phaseStatus && (
        <p className="dashboard-muted">
          Statut de la phase : {phaseStatus}
        </p>
      )}

      {error && (
        <p className="wolf-vote-error" role="alert">
          {error}
        </p>
      )}

      {success && (
        <p className="wolf-vote-success" role="status">
          {success}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary wolf-vote-close"
        onClick={() => void closeVote()}
        disabled={closing || loading || Boolean(phaseStatus && phaseStatus !== "open")}
      >
        {closing ? "Clôture en cours…" : "Clôturer le vote des Loups"}
      </button>

      <p className="dashboard-muted">
        Vérifie les résultats avant de clôturer : cette action déclenche
        la transition vers la prochaine phase prévue par le moteur de jeu.
      </p>
    </section>
  );
}