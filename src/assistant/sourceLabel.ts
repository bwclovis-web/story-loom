/*
 * The source label the app writes into assistant proposal packages. It lets a
 * package that was copied out and imported by hand link back to its
 * conversation. The label is only ever used to find a conversation in the same
 * project; it grants nothing.
 */

export function proposalSourceLabel(proposalId: string, conversationTitle: string, conversationId: string): string {
  return `Assistant proposal ${proposalId}, conversation "${conversationTitle}" (${conversationId})`;
}

const LABEL = /^Assistant proposal (apr_[A-Za-z0-9]+), conversation "[\s\S]*" \((asc_[A-Za-z0-9]+)\)$/;

export function parseProposalSourceLabel(label: string | null | undefined): { proposalId: string; conversationId: string } | null {
  const match = label ? LABEL.exec(label) : null;
  return match ? { proposalId: match[1], conversationId: match[2] } : null;
}
