import Link from 'next/link';

import { LandingBrand, LandingHeader } from '../components/landing/landing-header';
import {
  LandingAccountAction,
  LandingFooterAccountLink,
  LandingHomeLink,
} from '../components/landing/landing-auth-actions';
import { LandingIcon, type LandingIconName } from '../components/landing/landing-icons';
import { CoverageChecker } from '../features/coverage/coverage-checker';
import { HomeRouteGate } from '../features/auth/home-route-gate';
import { PublicPlanGrid } from '../features/plans/public-plan-grid';
import styles from '../styles/landing.module.css';

const features: Array<[LandingIconName, string, string]> = [
  ['layers', 'Simple plans', 'Straightforward internet plans without unnecessary complexity.'],
  [
    'cursor',
    'Easy online signup',
    'Check availability, select your plan and complete signup online.',
  ],
  [
    'settings',
    'Manage everything online',
    'Manage your account, subscription and billing from your dashboard.',
  ],
  ['headphones', 'Helpful support', 'Get assistance from Mero Telecom when you need it.'],
];

const speedGuide: Array<[LandingIconName, string, string, string]> = [
  [
    'gauge',
    'NBN 25',
    'Everyday Browsing',
    'Email, social media and light streaming on a single device.',
  ],
  ['activity', 'NBN 50', 'Household', 'Multiple devices, HD streaming and working from home.'],
  ['zap', 'NBN 100', 'Fast', 'Larger households, heavier streaming, gaming and downloads.'],
  ['rocket', 'NBN 250+', 'Very Fast', 'High-demand households with many connected devices.'],
];

const faqs = [
  [
    'What is NBN?',
    'The National Broadband Network is Australia’s broadband infrastructure, delivered through different access technologies depending on your address.',
  ],
  [
    'How do I check if Mero Telecom is available at my address?',
    'Use the address checker above. Select a recognised Australian address and Mero Telecom will return the current service estimate from its existing coverage system.',
  ],
  [
    'Which internet plan should I choose?',
    'Choose based on the number of people and devices in your home, the amount of streaming or gaming you do, and the speeds available at your address.',
  ],
  [
    'Can I change my plan later?',
    'Existing customers can review available subscription options from their customer dashboard.',
  ],
  [
    'How does billing work?',
    'The checkout flow confirms the current plan price and guides new or existing customers through the appropriate payment steps.',
  ],
  [
    'How long does connection take?',
    'Connection timing depends on your address, access technology and any work needed to activate the service.',
  ],
  [
    'What happens after I sign up?',
    'Mero Telecom’s existing checkout and account flow guides you through the next steps without changing the plan or coverage information you selected.',
  ],
  [
    'How can I contact Mero Telecom?',
    'Use the support options available in your customer account or sign in to manage your service.',
  ],
];

export default function HomePage() {
  return (
    <HomeRouteGate>
      <div className={styles.landing}>
        <LandingHeader />

        <main>
          <section className={styles.hero}>
            <div className={styles.heroGlow} aria-hidden="true" />
            <div className={`${styles.container} ${styles.heroGrid}`}>
              <div className={styles.heroCopy}>
                <p className={styles.pill}>
                  <span />
                  NBN plans for Australian homes
                </p>
                <h1>Fast, simple NBN internet for your home.</h1>
                <p className={styles.heroLead}>
                  Straightforward NBN plans, reliable connectivity and simple online signup with
                  Mero Telecom.
                </p>
                <div className={styles.heroButtons}>
                  <a className={styles.button} href="#coverage">
                    Check Your Address
                  </a>
                  <a className={`${styles.button} ${styles.buttonSecondary}`} href="#plans">
                    View NBN Plans
                  </a>
                </div>
                <div className={styles.heroBenefits}>
                  <span>
                    <LandingIcon name="shield" size={16} />
                    No confusing setup
                  </span>
                  <span>
                    <LandingIcon name="pin" size={16} />
                    Simple online signup
                  </span>
                  <span>
                    <LandingIcon name="headphones" size={16} />
                    Australian support
                  </span>
                </div>
              </div>

              <div aria-label="Mero Network connected" className={styles.networkCard}>
                <i className={styles.networkAccentTop} aria-hidden="true" />
                <i className={styles.networkAccentBottom} aria-hidden="true" />
                <div className={styles.networkTop}>
                  <span>
                    <i>
                      <LandingIcon name="wifi" size={18} />
                    </i>
                    Mero Network
                  </span>
                  <b>
                    <i />
                    Connected
                  </b>
                </div>
                <div className={styles.meterRow}>
                  <span>Download</span>
                  <strong>85 Mbps</strong>
                  <i className={styles.meter}>
                    <b className={styles.downloadMeter} />
                  </i>
                </div>
                <div className={styles.meterRow}>
                  <span>Upload</span>
                  <strong>40 Mbps</strong>
                  <i className={styles.meter}>
                    <b className={styles.uploadMeter} />
                  </i>
                </div>
                <div className={styles.networkStatus}>
                  <span>
                    Streaming<strong>Active</strong>
                  </span>
                  <span>
                    Gaming<strong>Active</strong>
                  </span>
                  <span>
                    Work<strong>Active</strong>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className={`${styles.section} ${styles.softSection}`} id="coverage">
            <div className={`${styles.container} ${styles.coverageWrap}`}>
              <CoverageChecker variant="landing" />
            </div>
          </section>

          <section className={styles.section} id="plans">
            <div className={styles.container}>
              <div className={styles.sectionHeading}>
                <h2>Internet plans that keep things simple</h2>
                <p>
                  Choose from a range of straightforward NBN plans. No lock-in contracts, unlimited
                  data and simple online signup.
                </p>
              </div>
              <PublicPlanGrid variant="landing" />
              <p className={styles.planDisclaimer}>
                Actual speeds may vary depending on NBN technology type, your location, network
                conditions, equipment and other factors. Prices are in AUD and include GST.
              </p>
            </div>
          </section>

          <section className={`${styles.section} ${styles.stepsSection}`}>
            <div className={styles.container}>
              <h2 className={styles.centerHeading}>Getting connected is simple</h2>
              <div className={styles.steps}>
                {[
                  [
                    'pin',
                    'Check your address',
                    'Select your recognised Australian address and confirm Mero Telecom availability.',
                  ],
                  [
                    'cursor',
                    'Choose your plan',
                    'Compare compatible plans and select the one that suits your household.',
                  ],
                  [
                    'rocket',
                    'Get connected',
                    'Continue through the existing secure signup and checkout flow.',
                  ],
                ].map(([icon, title, text], index) => (
                  <article key={title}>
                    <div className={styles.stepIcon}>
                      <span>{index + 1}</span>
                      <LandingIcon name={icon as LandingIconName} size={40} />
                    </div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.section} id="why-mero">
            <div className={styles.container}>
              <div className={styles.sectionHeading}>
                <h2>Internet without the unnecessary complexity</h2>
                <p>
                  Mero Telecom is built around a simple idea: straightforward NBN internet
                  that&apos;s easy to sign up for and manage.
                </p>
              </div>
              <div className={styles.featureGrid}>
                {features.map(([icon, title, text]) => (
                  <article key={title}>
                    <span>
                      <LandingIcon name={icon} size={25} />
                    </span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className={`${styles.section} ${styles.speedSection}`} id="internet">
            <div className={styles.container}>
              <div className={styles.sectionHeading}>
                <h2>Finding the right NBN speed</h2>
                <p>
                  Different speed tiers suit different households. Here&apos;s a general guide to
                  help you decide.
                </p>
              </div>
              <div className={styles.featureGrid}>
                {speedGuide.map(([icon, tier, title, text]) => (
                  <article key={tier}>
                    <span>
                      <LandingIcon name={icon} size={25} />
                    </span>
                    <small>{tier}</small>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
              <p className={styles.disclaimer}>
                Actual speeds can vary depending on NBN technology type, your location, network
                conditions, equipment in your home and other factors.
              </p>
            </div>
          </section>

          <section className={styles.accountSection}>
            <div className={styles.accountCard}>
              <span className={styles.accountIcon}>
                <LandingIcon name="login" size={29} />
              </span>
              <h2>Already with Mero Telecom?</h2>
              <p>Sign in to manage your service, billing and account.</p>
              <LandingAccountAction />
            </div>
          </section>

          <section className={styles.faqSection} id="faq">
            <div className={`${styles.container} ${styles.faqWrap}`}>
              <h2>Frequently asked questions</h2>
              <div className={styles.faqList}>
                {faqs.map(([question, answer]) => (
                  <details key={question}>
                    <summary>
                      <span>{question}</span>
                      <LandingIcon name="chevron" size={17} />
                    </summary>
                    <p>{answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        </main>

        <footer className={styles.footer}>
          <div className={`${styles.container} ${styles.footerGrid}`}>
            <div className={styles.footerBrand}>
              <LandingHomeLink>
                <LandingBrand />
              </LandingHomeLink>
              <p>Fast, simple NBN internet for Australian homes.</p>
            </div>
            <div>
              <h3>Mero Telecom</h3>
              <ul>
                <li>
                  <a href="#why-mero">About</a>
                </li>
                <li>
                  <a href="#why-mero">Why Mero</a>
                </li>
                <li>
                  <a href="#faq">Contact</a>
                </li>
              </ul>
            </div>
            <div>
              <h3>Internet</h3>
              <ul>
                <li>
                  <a href="#plans">NBN Plans</a>
                </li>
                <li>
                  <a href="#coverage">Check Coverage</a>
                </li>
                <li>
                  <a href="#internet">Internet</a>
                </li>
              </ul>
            </div>
            <div>
              <h3>Support</h3>
              <ul>
                <li>
                  <a href="#faq">Help Centre</a>
                </li>
                <li>
                  <a href="#faq">Contact Support</a>
                </li>
                <li>
                  <LandingFooterAccountLink />
                </li>
              </ul>
            </div>
            <div>
              <h3>Legal</h3>
              <ul>
                <li>
                  <Link href="/privacy">Privacy Policy</Link>
                </li>
                <li>
                  <Link href="/terms">Terms & Conditions</Link>
                </li>
                <li>
                  <Link href="/terms">Critical Information Summary</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className={`${styles.container} ${styles.footerBottom}`}>
            <p>
              Mero Telecom is not affiliated with or endorsed by NBN Co. NBN serviceability and
              speeds remain subject to address qualification.
            </p>
            <p>© 2026 Mero Telecom. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </HomeRouteGate>
  );
}
