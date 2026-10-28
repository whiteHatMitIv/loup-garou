import {
  ArrowRight,
  ArrowUpRight,
  ClipboardList,
  Eye,
  LockKeyhole,
  Moon,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Vote,
} from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: LockKeyhole,
    eyebrow: "CONFIDENTIALITÉ",
    title: "Un rôle. Un secret.",
    description:
      "Chaque joueur découvre son rôle dans son espace privé. Les informations confidentielles restent protégées.",
  },
  {
    icon: Vote,
    eyebrow: "INTERACTIONS",
    title: "Les décisions comptent.",
    description:
      "Votes, choix des Loups et pouvoirs spéciaux seront gérés directement dans l'application.",
  },
  {
    icon: Trophy,
    eyebrow: "CLASSEMENT",
    title: "Chaque point a son histoire.",
    description:
      "Les scores sont calculés selon les règles de la partie, avec un classement final prêt à partager.",
  },
];

const steps = [
  {
    number: "01",
    title: "Rejoignez le village",
    description:
      "Le maître du jeu partage un lien dans WhatsApp. Les participants saisissent leur prénom et attendent la validation.",
  },
  {
    number: "02",
    title: "Découvrez votre rôle",
    description:
      "Les rôles sont distribués en privé. Chacun peut agir uniquement lorsque son pouvoir ou son vote est disponible.",
  },
  {
    number: "03",
    title: "Survivez jusqu'à l'aube",
    description:
      "Les nuits, les votes et les éliminations font évoluer la partie jusqu'à la victoire d'un camp.",
  },
];

export default function HomePage() {
  return (
    <main className="site-shell">
      <header className="site-header">
        <div className="container header-inner">
          <Link href="/" className="brand" aria-label="Nocturne, accueil">
            <span className="brand-mark" aria-hidden="true">
              <Moon />
            </span>
            <span>NOCTURNE</span>
          </Link>

          <nav className="header-nav" aria-label="Navigation principale">
            <Link href="#fonctionnement">Le jeu</Link>
            <Link href="#fonctionnalites">Fonctionnalités</Link>
            <Link href="/login">Maître du jeu</Link>
          </nav>

          <Link className="header-action" href="/login">
            Espace maître
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-dot" />
              LE VILLAGE S&apos;ENDORT
            </div>

            <h1 className="hero-title">
              La nuit tombe.
              <span className="title-accent">Qui dit vrai ?</span>
            </h1>

            <p className="hero-description">
              Les alliances se forment, les soupçons grandissent et chaque
              décision compte. Retrouve ta communauté pour une partie de
              Loup-Garou où personne n&apos;est à l&apos;abri.
            </p>

            <div className="hero-actions">
              <Link className="btn btn-primary" href="#fonctionnement">
                Découvrir le jeu
                <ArrowRight aria-hidden="true" />
              </Link>

              <Link className="btn btn-secondary" href="/login">
                L&apos;espace du maître
              </Link>
            </div>

            <div className="hero-footnote">
              <ShieldCheck aria-hidden="true" />
              <span>
                Rôles secrets, votes encadrés et résultats calculés selon les
                règles de la partie.
              </span>
            </div>
          </div>

          <div className="preview-wrap" aria-label="Aperçu illustratif du jeu">
            <div className="preview-glow" />

            <div className="preview-card">
              <div className="preview-top">
                <div className="preview-brand">
                  <Moon aria-hidden="true" />
                  <span>Le village</span>
                </div>

                <span className="preview-label">APERÇU VISUEL</span>
              </div>

              <div className="preview-game-heading">
                <div>
                  <div className="preview-label">PARTIE DE DÉMONSTRATION</div>
                  <h2>La Nuit des Ombres</h2>
                </div>

                <span className="preview-phase">NUIT 02</span>
              </div>

              <p className="preview-subtitle">
                Le village est silencieux. Les rôles concernés peuvent agir.
              </p>

              <div className="preview-stat-grid">
                <div className="preview-stat">
                  <strong>12</strong>
                  <span>Participants</span>
                </div>

                <div className="preview-stat">
                  <strong>9</strong>
                  <span>En vie</span>
                </div>

                <div className="preview-stat">
                  <strong>3</strong>
                  <span>Éliminés</span>
                </div>
              </div>

              <div className="preview-list">
                <div className="preview-list-heading">
                  <span>Dans le village</span>
                  <span>Exemple fictif</span>
                </div>

                <div className="preview-row">
                  <div className="player-avatar">A</div>
                  <div className="player-info">
                    <strong>Aline</strong>
                    <span>En attente d&apos;une action</span>
                  </div>
                  <span className="player-state">En vie</span>
                </div>

                <div className="preview-row">
                  <div className="player-avatar">M</div>
                  <div className="player-info">
                    <strong>Marc</strong>
                    <span>Phase nocturne</span>
                  </div>
                  <span className="player-state neutral">Actif</span>
                </div>

                <div className="preview-row">
                  <div className="player-avatar">S</div>
                  <div className="player-info">
                    <strong>Sarah</strong>
                    <span>En attente d&apos;une action</span>
                  </div>
                  <span className="player-state">En vie</span>
                </div>
              </div>

              <div className="preview-bottom">
                <Sparkles aria-hidden="true" />
                <span>
                  Maquette visuelle : les noms et les chiffres sont fictifs.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="community-strip">
        <div className="container community-inner">
          <span className="community-label">Pensé pour votre communauté</span>

          <span className="community-item">
            <Users aria-hidden="true" />
            Des joueurs réunis
          </span>

          <span className="community-item">
            <Eye aria-hidden="true" />
            Des rôles secrets
          </span>

          <span className="community-item">
            <ClipboardList aria-hidden="true" />
            Des règles suivies
          </span>
        </div>
      </div>

      <section className="section" id="fonctionnalites">
        <div className="container">
          <div className="section-heading">
            <Link href="#fonctionnalites" className="section-kicker">
              L&apos;expérience de jeu
            </Link>

            <h2 className="section-title">
              Toute la partie.
              <br />
              Un seul endroit.
            </h2>

            <p className="section-description">
              De la distribution des rôles jusqu&apos;au classement final,
              l&apos;application est conçue pour garder le jeu organisé sans
              enlever le plaisir du mystère.
            </p>
          </div>

          <div className="feature-grid">
            {features.map((feature) => {
              const Icon = feature.icon;

              return (
                <article className="feature-card" key={feature.title}>
                  <div className="feature-icon">
                    <Icon aria-hidden="true" />
                  </div>

                  <div className="section-kicker" style={{ marginTop: 22 }}>
                    {feature.eyebrow}
                  </div>

                  <h3>{feature.title}</h3>

                  <p>{feature.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section steps-section" id="fonctionnement">
        <div className="container">
          <div className="section-heading">
            <span className="section-kicker">Comment ça marche</span>

            <h2 className="section-title">
              Une partie, trois étapes.
            </h2>

            <p className="section-description">
              WhatsApp reste votre espace de rassemblement. Nocturne prend
              en charge le déroulement du jeu.
            </p>
          </div>

          <div className="steps-grid">
            {steps.map((step) => (
              <article className="step-card" key={step.number}>
                <span className="step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="maitre">
        <div className="container">
          <div className="community-panel">
            <div>
              <span className="section-kicker">
                POUR LE MAÎTRE DU JEU
              </span>

              <h2>Tu diriges la partie. Le jeu garde le fil.</h2>

              <p>
                Le dashboard permettra de suivre les joueurs, contrôler les
                phases, valider les résultats et préparer les annonces à
                copier dans WhatsApp. Les règles et les scores seront gérés
                par le moteur de jeu.
              </p>
            </div>

            <div className="community-panel-action">
              <Link className="btn btn-primary" href="#fonctionnalites">
                Voir les fonctionnalités
                <ArrowRight aria-hidden="true" />
              </Link>

              <span className="community-panel-note">
                Aperçu du projet en construction
              </span>
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container footer-inner">
          <Link href="/" className="brand" aria-label="Nocturne, accueil">
            <span className="brand-mark" aria-hidden="true">
              <Moon />
            </span>
            <span>NOCTURNE</span>
          </Link>

          <span className="footer-copy">
            Une communauté. Des rôles secrets. Une nuit pleine de soupçons.
          </span>

          <span className="footer-note">
            <Swords aria-hidden="true" />
            Que la partie commence.
          </span>
        </div>
      </footer>
    </main>
  );
}