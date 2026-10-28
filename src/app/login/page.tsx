"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Moon, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const supabase = createClient();

      const { error: loginError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (loginError) {
        setError("Adresse e-mail ou mot de passe incorrect.");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(
        "Impossible de contacter le serveur. Vérifie ta connexion et réessaie."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link href="/" className="brand auth-brand">
          <span className="brand-mark">
            <Moon />
          </span>
          <span>NOCTURNE</span>
        </Link>

        <div className="auth-icon">
          <ShieldCheck size={25} />
        </div>

        <p className="section-kicker">ESPACE PRIVÉ</p>

        <h1 className="auth-title">Bienvenue, maître du jeu.</h1>

        <p className="auth-description">
          Connecte-toi pour organiser tes parties, gérer les joueurs
          et consulter les résultats.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="email">Adresse e-mail</label>

            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="ton@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">Mot de passe</label>

            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Ton mot de passe"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <LoaderCircle className="auth-spinner" />
                Connexion...
              </>
            ) : (
              <>
                Accéder au dashboard
                <ArrowRight />
              </>
            )}
          </button>
        </form>

        <p className="auth-footnote">
          <ShieldCheck size={15} />
          Accès réservé au compte autorisé du maître du jeu.
        </p>
      </section>
    </main>
  );
}