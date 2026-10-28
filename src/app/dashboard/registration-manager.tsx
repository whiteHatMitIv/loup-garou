"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  LoaderCircle,
  RefreshCw,
  UserCheck,
  Users,
  X,
} from "lucide-react";

type Registration = {
  id: string;
  gameId: string;
  gameName: string;
  displayName: string;
  joinedAt: string;
};

export default function RegistrationManager() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadRegistrations = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/master/registrations", {
        cache: "no-store",
      });

      const result = (await response.json()) as {
        registrations?: Registration[];
        error?: string;
      };

      if (!response.ok || !result.registrations) {
        setError(result.error ?? "Impossible de charger les inscriptions.");
        return;
      }

      setRegistrations(result.registrations);
      setError("");
    } catch {
      setError("Le serveur est inaccessible.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRegistrations();

    // Actualise la liste pendant que le dashboard est ouvert.
    const interval = window.setInterval(() => {
      void loadRegistrations(true);
    }, 10000);

    return () => window.clearInterval(interval);
  }, [loadRegistrations]);

  async function decide(
    registration: Registration,
    decision: "approve" | "reject"
  ) {
    setBusyId(registration.id);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/master/registrations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playerId: registration.id,
          decision,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        setError(result.error ?? "Impossible de traiter cette demande.");
        await loadRegistrations(true);
        return;
      }

      setRegistrations((current) =>
        current.filter((item) => item.id !== registration.id)
      );

      setMessage(
        decision === "approve"
          ? `${registration.displayName} a été accepté dans la partie.`
          : `La demande de ${registration.displayName} a été refusée.`
      );
    } catch {
      setError("Le serveur est inaccessible. Réessaie.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="dashboard-panel registration-manager">
      <div className="dashboard-panel-heading">
        <div>
          <p className="section-kicker">ACCÈS AU VILLAGE</p>
          <h2>Demandes d&apos;inscription</h2>
        </div>

        <div className="registration-heading-actions">
          <span className="dashboard-count">{registrations.length}</span>

          <button
            type="button"
            className="icon-button"
            onClick={() => void loadRegistrations(true)}
            disabled={refreshing}
            aria-label="Actualiser les demandes"
            title="Actualiser les demandes"
          >
            {refreshing ? (
              <LoaderCircle className="auth-spinner" size={17} />
            ) : (
              <RefreshCw size={17} />
            )}
          </button>
        </div>
      </div>

      <p className="registration-intro">
        Vérifie les noms puis accepte ou refuse chaque joueur avant le
        lancement de la partie.
      </p>

      {error && (
        <p className="auth-error registration-feedback" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="registration-success" role="status">
          <Check size={16} />
          {message}
        </p>
      )}

      {loading ? (
        <div className="registration-empty" role="status">
          <LoaderCircle className="auth-spinner" size={22} />
          <p>Chargement des demandes...</p>
        </div>
      ) : registrations.length === 0 ? (
        <div className="registration-empty">
          <div className="dashboard-empty-icon">
            <Users size={23} />
          </div>

          <h3>Aucune demande en attente</h3>

          <p>
            Les nouvelles demandes apparaîtront ici. Cette liste est
            actualisée automatiquement pendant que le dashboard reste ouvert.
          </p>
        </div>
      ) : (
        <div className="registration-list">
          {registrations.map((registration) => (
            <article
              key={registration.id}
              className="registration-item"
            >
              <div className="player-avatar">
                {registration.displayName.charAt(0).toLocaleUpperCase("fr-FR")}
              </div>

              <div className="registration-player-info">
                <strong>{registration.displayName}</strong>
                <span>{registration.gameName}</span>
                <span className="dashboard-muted">
                  Demande reçue le{" "}
                  {new Date(registration.joinedAt).toLocaleDateString(
                    "fr-FR"
                  )}
                </span>
              </div>

              <div className="registration-actions">
                <button
                  type="button"
                  className="registration-approve"
                  onClick={() => void decide(registration, "approve")}
                  disabled={busyId !== null}
                  aria-label={`Accepter ${registration.displayName}`}
                  title="Accepter"
                >
                  {busyId === registration.id ? (
                    <LoaderCircle className="auth-spinner" size={17} />
                  ) : (
                    <UserCheck size={17} />
                  )}
                  <span>Accepter</span>
                </button>

                <button
                  type="button"
                  className="registration-reject"
                  onClick={() => void decide(registration, "reject")}
                  disabled={busyId !== null}
                  aria-label={`Refuser ${registration.displayName}`}
                  title="Refuser"
                >
                  <X size={17} />
                  <span>Refuser</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}