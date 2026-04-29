import Link from "next/link";

const sections = [
  {
    title: "1. Scope of Service",
    body:
      "TCE Voice IQ is provided as a communications workflow application for business users who place, receive, route, document, and review calls and related customer interactions. The service may include web calling tools, desktop bridge features, analytics, call activity records, support routing, and related telecom productivity functions.",
  },
  {
    title: "2. Authorized Use",
    body:
      "You may use the service only for lawful business purposes, in accordance with your organization's internal policies, applicable telecom regulations, privacy obligations, and any restrictions imposed by your carrier, PBX, call-recording provider, or platform administrator. You are responsible for ensuring that all dialing activity, call routing, call recording, voicemail handling, and contact processing are permitted in your jurisdiction.",
  },
  {
    title: "3. User Accounts and Credentials",
    body:
      "You must maintain the confidentiality of all login credentials, SIP credentials, bridge tokens, API keys, and related authentication materials used with the service. You are responsible for activity that occurs under your account or workstation unless you promptly report unauthorized access and cooperate with reasonable remediation steps.",
  },
  {
    title: "4. Communications Compliance",
    body:
      "You acknowledge that telecommunications, text messaging, call recording, consent capture, and customer contact workflows may be regulated by federal, state, local, and industry-specific rules. TCE Voice IQ is a software tool and does not guarantee that your organization is compliant with all legal requirements. You remain responsible for determining whether consent, disclosure, retention, opt-out handling, or other compliance controls are required for your use case.",
  },
  {
    title: "5. Acceptable Restrictions",
    body:
      "You may not use the service to place unlawful robocalls, impersonate another person or entity, interfere with emergency communications, overload carrier infrastructure, reverse engineer protected service components except where required by law, or use the platform in a manner that harms service availability, security, or data integrity for other customers.",
  },
  {
    title: "6. Customer Data and Operational Records",
    body:
      "The service may process phone numbers, contact records, call notes, metadata, support requests, transcripts, and similar operational information provided by you or your organization. You represent that you have the right to supply and process that information through the service. TCE may retain operational logs, audit trails, and support records as reasonably necessary for security, troubleshooting, product improvement, and contractual performance.",
  },
  {
    title: "7. Availability and Support",
    body:
      "TCE will use commercially reasonable efforts to provide reliable service availability, but does not warrant uninterrupted or error-free operation. Maintenance windows, third-party carrier events, browser limitations, device restrictions, power loss, and network interruptions may affect call handling or feature availability.",
  },
  {
    title: "8. Intellectual Property",
    body:
      "The application interface, software logic, integrations, branding, documentation, and related materials remain the property of TCE or its licensors, except for customer-owned data and content supplied by users. These Terms grant a limited, revocable, non-exclusive right to use the service during the applicable subscription or authorized access period.",
  },
  {
    title: "9. Warranty Disclaimer",
    body:
      "Except as expressly stated in a signed agreement, the service is provided on an 'as is' and 'as available' basis. To the maximum extent permitted by law, TCE disclaims implied warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted availability.",
  },
  {
    title: "10. Limitation of Liability",
    body:
      "To the maximum extent permitted by law, TCE will not be liable for indirect, incidental, consequential, special, punitive, or exemplary damages, or for lost profits, lost data, business interruption, or loss of goodwill arising from or related to use of the service. Any direct liability shall be limited to the amounts paid for the service during the twelve months preceding the event giving rise to the claim, unless a different cap is set in a governing written agreement.",
  },
  {
    title: "11. Suspension and Termination",
    body:
      "TCE may suspend or terminate access where reasonably necessary to protect security, investigate misuse, respond to legal process, prevent unlawful telecom activity, enforce these Terms, or address non-payment or contractual breach. Upon termination, access rights end immediately, subject to any post-termination data-handling obligations in an applicable agreement.",
  },
  {
    title: "12. Draft Status and Future Revision",
    body:
      "This page is a working Terms of Use template for interim product use and should be reviewed and finalized with legal counsel before production publication. TCE may revise these Terms from time to time by updating this page or publishing a replacement legal notice.",
  },
];

export const metadata = {
  title: "Terms of Use | TCE Voice IQ",
  description: "Draft terms of use for TCE Voice IQ.",
};

export default function TermsOfUsePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_22%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] px-4 py-10 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200 transition hover:border-cyan-400/35 hover:bg-slate-900"
          >
            ← Back to Dialer
          </Link>
        </div>

        <section className="overflow-hidden rounded-[32px] border border-slate-800 bg-slate-950/80 shadow-[0_35px_100px_rgba(2,8,23,0.5)]">
          <div className="border-b border-slate-800 bg-[linear-gradient(135deg,rgba(8,17,31,0.96),rgba(15,23,42,0.9))] px-6 py-8 sm:px-10">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.26em] text-cyan-300">Telecom Application Legal Notice</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Terms of Use</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              This draft Terms of Use page is designed for a telecom and operator-console application and is suitable as an editable interim legal framework while formal counsel review is pending.
            </p>
          </div>

          <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-6">
              {sections.map((section) => (
                <section
                  key={section.title}
                  className="rounded-3xl border border-slate-800 bg-slate-900/65 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                >
                  <h2 className="text-lg font-semibold text-white">{section.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{section.body}</p>
                </section>
              ))}
            </div>

            <aside className="h-fit rounded-3xl border border-cyan-400/20 bg-cyan-400/8 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">Drafting Notes</h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                <li>Replace placeholders with your governing entity name, state, and effective date.</li>
                <li>Add any call recording, SMS, retention, HIPAA, FINRA, or carrier-specific provisions that apply.</li>
                <li>Review dispute resolution, governing law, and enterprise contract precedence with counsel.</li>
                <li>Confirm whether a separate privacy notice, acceptable use policy, or DPA should be linked here.</li>
              </ul>

              <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-xs leading-6 text-slate-400">
                Template status: suitable as an internal or staging placeholder, not a substitute for jurisdiction-specific legal advice.
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
