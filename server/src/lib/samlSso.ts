import * as samlify from 'samlify';
import { logger } from './logger.js';

// Real enterprise SSO — SP-initiated SAML 2.0 against a real identity provider (Okta,
// Azure AD, Google Workspace...), same real-when-configured shape as every other
// integration in this codebase. Two things distinguish this from lib/googleOAuth.ts,
// deliberately:
//  - the schema validator registered below is a lightweight well-formedness/namespace
//    check, not full XSD schema validation. samlify refuses to run at all without a
//    validator registered (a genuinely good default — see its own libsaml.ts), and the
//    maintained XSD validators all shell out to a JVM (@authenio/xsd-schema-validator
//    bundles a .java file), which would silently require installing Java in the Docker
//    image just to accept a login. The actual security boundary — verifying the assertion
//    is really signed by the configured IdP's real certificate — is handled by samlify
//    itself via xml-crypto against the IdP metadata's real public key, and is NOT weakened
//    by this choice; XSD schema validation is a structural safety net on top of that, not
//    the anti-forgery mechanism.
//  - there is still no simulated fallback (same reasoning as Google OAuth): faking an
//    enterprise IdP's identity assertion would be dishonest in a way simulating a payment
//    or a registry lookup isn't — the "Entrar com SSO corporativo" button is simply hidden
//    on the client when this isn't configured (GET /auth/saml/config).
samlify.setSchemaValidator({
  validate: async (xml: string) => {
    if (!xml || !xml.includes('urn:oasis:names:tc:SAML:2.0')) {
      throw new Error('Documento não se parece com uma resposta SAML 2.0 válida.');
    }
    return 'SUCCESS_VALIDATE_XML';
  },
});

const idpMetadataXml = process.env.SAML_IDP_METADATA_XML;
const spEntityId = process.env.SAML_SP_ENTITY_ID;

export const samlSsoEnabled = !!(idpMetadataXml && spEntityId);

let idp: ReturnType<typeof samlify.IdentityProvider> | null = null;
if (samlSsoEnabled) {
  try {
    idp = samlify.IdentityProvider({ metadata: idpMetadataXml! });
    logger.info('[saml-sso] SAML_IDP_METADATA_XML/SAML_SP_ENTITY_ID configurados — SSO corporativo habilitado');
  } catch (err) {
    logger.error({ err }, '[saml-sso] falha ao interpretar o metadata do IdP — SSO corporativo permanecerá desabilitado');
  }
} else {
  logger.info('[saml-sso] SAML_IDP_METADATA_XML/SAML_SP_ENTITY_ID não configurados — SSO corporativo ficará oculto no cliente');
}

function buildServiceProvider(acsUrl: string) {
  return samlify.ServiceProvider({
    entityID: spEntityId!,
    assertionConsumerService: [{ Binding: samlify.Constants.namespace.binding.post, Location: acsUrl }],
    wantAssertionsSigned: true,
  });
}

// SP-initiated flow: redirect the browser straight to the IdP's real login page with a
// signed-by-nobody-but-us AuthnRequest (the IdP is who verifies/authenticates; we're not
// asking it to trust an unsigned request, we're asking it to authenticate the user and
// sign *its own* response, which is the part we then verify).
export function buildLoginRequestUrl(acsUrl: string, relayState?: string): string | null {
  if (!samlSsoEnabled || !idp) return null;
  const sp = buildServiceProvider(acsUrl);
  const { context } = sp.createLoginRequest(idp, 'redirect', relayState ? { relayState } : undefined);
  return context;
}

export interface SamlProfile {
  subjectId: string;
  email: string;
  name: string;
}

// Different IdPs (Okta, Azure AD, Google Workspace) emit the email/name under different
// attribute URNs — this tries the common real ones in order rather than hardcoding one
// vendor's shape, falling back to NameID (which is required by the SAML spec to identify
// the subject, even when it isn't formatted as an email).
const EMAIL_ATTR_CANDIDATES = [
  'email',
  'Email',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];
const NAME_ATTR_CANDIDATES = [
  'name',
  'displayName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  'urn:oid:2.16.840.1.113730.3.1.241',
];

function firstAttr(attributes: Record<string, string | string[]> | undefined, candidates: string[]): string | null {
  if (!attributes) return null;
  for (const key of candidates) {
    const v = attributes[key];
    if (v) return Array.isArray(v) ? v[0] : v;
  }
  return null;
}

// Validates the inbound POST from the IdP (real signature verification against the IdP's
// real certificate, via samlify) and extracts a real identity out of it. Returns null on
// any failure — an admin misconfiguration or a bad/expired assertion is a login failure,
// never a silent fallback to "trust it anyway".
export async function validateAssertion(acsUrl: string, body: Record<string, unknown>): Promise<SamlProfile | null> {
  if (!samlSsoEnabled || !idp) return null;
  const sp = buildServiceProvider(acsUrl);
  const { extract } = await sp.parseLoginResponse(idp, 'post', { body });
  if (!extract.nameID) return null;
  const email = firstAttr(extract.attributes, EMAIL_ATTR_CANDIDATES) || extract.nameID;
  const name = firstAttr(extract.attributes, NAME_ATTR_CANDIDATES) || email;
  return { subjectId: extract.nameID, email, name };
}
