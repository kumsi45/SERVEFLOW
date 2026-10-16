import type { ReactNode } from "react";
import { PublicPageLayout } from "../components/PublicPageLayout";
import { usePublicMetadata } from "../hooks/usePublicMetadata";

type LegalSection = { id: string; title: string; content: ReactNode };
type LegalDocument = { title: string; description: string; introduction: string; sections: LegalSection[] };

const documents = {
  privacy: {
    title: "Privacy Policy",
    description: "Draft information about account, business, customer and staff data handled through ServeFlow.",
    introduction: "This draft explains the information involved in using ServeFlow and the different responsibilities of the platform and the hospitality business you interact with.",
    sections: [
      { id: "information", title: "Information used in the service", content: <>
        <p>Depending on the features used, ServeFlow handles the following information:</p>
        <ul>
          <li>Account and setup details, such as names, email addresses, business details and account credentials.</li>
          <li>Staff identities, assigned roles, access records and activity associated with a business workspace.</li>
          <li>Business menus, stock records, orders, receipts and operational reports.</li>
          <li>QR ordering details, browser session identifiers and order-tracking information. Customer details depend on the ordering flow and the information supplied.</li>
          <li>Customer feedback and any related images submitted through available features.</li>
          <li>Payment references and uploaded payment evidence, such as screenshots, when those features are used.</li>
        </ul>
        <p>Submitting payment evidence is not the same as automatic payment collection or confirmation by a payment provider. Do not upload passwords, payment PINs or information unrelated to the transaction.</p>
      </> },
      { id: "purposes", title: "How information supports the service", content: <p>Information supports account access, business setup, staff permissions, order processing, kitchen coordination, inventory work, payment review, customer feedback and business reporting. Browser storage also helps retain sessions, preferences and order context. The <a href="/cookies">Cookie Policy</a> describes these storage categories.</p> },
      { id: "business-responsibilities", title: "The hospitality business and ServeFlow", content: <>
        <p>The hospitality business manages its workspace, its staff access and the customer information entered through its service. Contact that business about your order, its staff practices or its use of your information.</p>
        <p>ServeFlow provides the software used for these workflows. Contact ServeFlow about platform account or technical questions. The responsibilities and data-handling arrangements for a business customer should be confirmed in its service agreement.</p>
      </> },
      { id: "services-and-contact", title: "Technical services and contact channels", content: <>
        <p>Online account access, data storage and other features depend on supporting technical services. The applicable service-provider and data-handling arrangements should be confirmed before a business begins using the service.</p>
        <p>Our WhatsApp contact links open an external service. Information you choose to send there is also subject to that service's practices. Avoid sending credentials or unnecessary customer and payment information through a support conversation.</p>
      </> },
      { id: "records", title: "Records, access and questions", content: <>
        <p>Ending a browser session or clearing local site data does not remove business records stored by the service. Records may still be relevant to business history, payment reconciliation or a dispute.</p>
        <p>Ask the hospitality business about information held in its workspace. For platform-related access, correction or removal questions, <a href="/contact">contact ServeFlow</a>. Record handling and retention arrangements need to be confirmed for the relevant service and request.</p>
      </> },
    ],
  },
  terms: {
    title: "Terms of Service",
    description: "Draft terms for discussing and using ServeFlow hospitality software and business workspaces.",
    introduction: "ServeFlow provides connected tools for hospitality businesses, including restaurants, cafés, hotel food-and-beverage outlets, bars and lounges. This draft outlines expectations for using those tools.",
    sections: [
      { id: "service", title: "Service scope", content: <p>Available features support workflows such as QR menus and ordering, staff access, cashier and kitchen operations, inventory and reporting. Availability depends on the product and setup agreed with your business. Future product plans are not a commitment to deliver a particular feature.</p> },
      { id: "access", title: "Accounts and business authority", content: <p>Use a workspace only with appropriate authorization. Business administrators are responsible for granting staff access suited to each person's role and keeping account details accurate. Keep credentials private and report suspected unauthorized access through <a href="/contact">Contact support</a>.</p> },
      { id: "commercial", title: "Trials and commercial arrangements", content: <>
        <p>Trial requests are subject to review. An inquiry or account registration is not confirmation of a commercial trial arrangement. Confirm approval, access dates and any trial duration directly before relying on them.</p>
        <p>Pricing is discussed with each business. Any paid service term, payment arrangement, renewal or change to access must be confirmed directly. Do not assume automatic billing or renewal from an account or dashboard label.</p>
      </> },
      { id: "business-records", title: "Orders, payments and business records", content: <>
        <p>The hospitality business is responsible for its customer service, menu information, prices and review of payment evidence. Software records and uploaded evidence do not, by themselves, establish that a payment provider has collected or verified a payment.</p>
        <p>For questions about an order or payment, contact the hospitality business first. Discuss access to past business information and any change to service access with your administrator or ServeFlow. Do not assume that ending use deletes stored records.</p>
      </> },
      { id: "responsible-use", title: "Responsible use and data", content: <p>Use the service in accordance with the <a href="/acceptable-use">Acceptable Use Policy</a>. Only enter or upload information you are authorized to use. Review the <a href="/privacy">Privacy Policy</a> and <a href="/cookies">Cookie Policy</a> for draft information about the data and browser storage involved.</p> },
      { id: "arrangements", title: "Questions before using the service", content: <p>Confirm the service scope and commercial arrangements for your business before beginning use. <a href="/contact">Contact ServeFlow</a> to discuss setup, trial review, pricing or support.</p> },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    description: "Draft information about cookies, browser storage, sessions and preferences when using ServeFlow.",
    introduction: "Cookies and browser storage are different technologies. ServeFlow's application uses browser storage for operational features; this draft explains those uses without assuming that every page or hosting service behaves the same way.",
    sections: [
      { id: "browser-storage", title: "Browser storage used by the application", content: <>
        <p>Session storage supports tab identifiers and authentication sessions. Some session storage is initialized when you open the application, including its public information pages.</p>
        <p>Depending on the features you use, local storage also retains menu-language preferences, cart and order context, customer order tracking and other operational preferences. Staff workflows may store terminal preferences or temporary work in progress.</p>
      </> },
      { id: "cookies-and-services", title: "Cookies and external services", content: <>
        <p>Browser-storage uses described here do not establish whether cookies are set by a particular hosting setup or supporting service. They also do not establish whether a page makes third-party requests.</p>
        <p>Following a WhatsApp or other external link takes you to another service, whose cookie and privacy practices apply there. This document does not represent a complete inventory of a live deployment's cookies or tracking.</p>
      </> },
      { id: "storage-lifetime", title: "How long browser information remains", content: <p>Some information is scoped to a tab or session; other information may remain in local storage until cleared by the application or through browser controls. Browser settings and session restoration can affect how long it remains. No single lifetime applies to every storage category.</p> },
      { id: "controls", title: "Your browser controls", content: <p>You can manage site data through your browser settings. Clearing it can sign you out, reset preferences or remove saved cart and order-tracking context on that browser. Cookie controls may not clear every type of browser storage. Clearing browser data does not delete records held by a hospitality business or the service.</p> },
      { id: "questions", title: "Questions about site data", content: <p><a href="/contact">Contact ServeFlow</a> with questions about browser storage or a particular service arrangement. If you follow a business's QR menu, that business can also help explain its order and customer-data practices.</p> },
    ],
  },
  "acceptable-use": {
    title: "Acceptable Use Policy",
    description: "Draft expectations for responsible use of ServeFlow accounts, hospitality workspaces and customer information.",
    introduction: "Use ServeFlow responsibly and respect the hospitality businesses, staff and customers whose information and daily work depend on the service.",
    sections: [
      { id: "authorized-use", title: "Use only authorized access", content: <p>Do not access another business's workspace or records without permission, share credentials to bypass role restrictions, impersonate a user, or attempt to grant yourself unauthorized privileges.</p> },
      { id: "service-abuse", title: "Do not disrupt or abuse the service", content: <p>Do not introduce malicious software, probe for unauthorized access, overwhelm endpoints, automate abusive requests, interfere with other users, or attempt to bypass security and usage restrictions.</p> },
      { id: "honest-records", title: "Keep records and evidence honest", content: <p>Do not submit fraudulent orders, fabricated payment evidence or misleading business records. Do not use the service for unlawful activity, harassment, or content you are not entitled to upload or share.</p> },
      { id: "tenant-responsibility", title: "Protect staff and customer information", content: <p>Business administrators should give staff access appropriate to their responsibilities. Enter only information needed for the relevant business workflow and protect customer records, uploaded files and account credentials from unauthorized disclosure.</p> },
      { id: "reporting", title: "Report concerns", content: <p>Tell your business administrator about suspected misuse in your workspace, or <a href="/contact">contact ServeFlow support</a> about a platform concern. Share relevant context without sending passwords, payment PINs or unnecessary personal records. Misuse may result in access restrictions, subject to the applicable service arrangements and review.</p> },
    ],
  },
} satisfies Record<string, LegalDocument>;

export type PublicLegalPageId = keyof typeof documents;

export function PublicLegalPage({ documentId }: { documentId: PublicLegalPageId }) {
  const document = documents[documentId];
  usePublicMetadata(`${document.title} | ServeFlow`, document.description);

  return <PublicPageLayout>
    <article className="lp-legal-page lp-container">
      <header className="lp-legal-header">
        <p className="lp-eyebrow">ServeFlow · Legal</p>
        <h1>{document.title}</h1>
        <p className="lp-legal-introduction">{document.introduction}</p>
        <aside className="lp-legal-notice" aria-label="Draft document status">
          <strong>Draft for review</strong>
          <p>This document has not been finalized. It requires qualified legal review before it is treated as final legal terms or relied upon for launch.</p>
        </aside>
      </header>
      <nav className="lp-legal-contents" aria-label={`${document.title} contents`}>
        <h2>On this page</h2>
        <ul>{document.sections.map(({ id, title }) => <li key={id}><a href={`#${id}`}>{title}</a></li>)}</ul>
      </nav>
      <div className="lp-legal-sections">{document.sections.map(({ id, title, content }) =>
        <section id={id} key={id} aria-labelledby={`${id}-heading`}>
          <h2 id={`${id}-heading`}>{title}</h2>{content}
        </section>,
      )}</div>
      <p className="lp-legal-contact">Need help? <a href="/contact">Contact ServeFlow</a>.</p>
    </article>
  </PublicPageLayout>;
}
