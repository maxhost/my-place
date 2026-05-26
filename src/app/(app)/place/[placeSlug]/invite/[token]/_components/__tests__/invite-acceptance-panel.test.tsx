/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AcceptInvitationInput,
  AcceptInvitationResult,
} from "@/features/invitations/public";

import {
  InviteAcceptancePanel,
  type InviteAcceptancePanelLabels,
} from "../invite-acceptance-panel";

// V1.1 S3 — RTL del Client `<InviteAcceptancePanel />`. 8 escenarios: 3
// estados render (unauth / match / mismatch) + 4 error mappings DEFINER → UX
// + 1 success-path navigation. Canon ADR-0034 §"seam-split": Client +
// puertos inyectados (action + navigate + onLogout), nada de mock de Server
// Action runtime ni next/navigation real. Labels EN placeholder pre-S4.

const labels: InviteAcceptancePanelLabels = {
  header: "Invitation to {placeName}",
  previewEmail: "This invitation is for {email}",
  acceptButton: "Accept invitation to {placeName}",
  declineLink: "No, thanks",
  ctaLogin: "Sign in",
  ctaSignup: "Create account",
  emailMismatchTitle: "Email does not match",
  emailMismatchBody:
    "This invitation is for {invEmail}. You are signed in as {currentEmail}.",
  emailMismatchLogoutCta: "Sign out and sign in as {invEmail}",
  errorExpired: "This invitation has expired. Ask whoever invited you for a new one.",
  errorAlreadyUsed: "This invitation has already been used.",
  errorPlaceFull: "This place has reached its 150-member cap. Contact the owner.",
  errorUnknown: "Something went wrong. Try again or request a new invitation.",
};

const baseProps = {
  token: "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd",
  placeSlug: "mi-place",
  placeName: "Mi Place",
  inviteeEmail: "invitee@example.com",
  loginUrl:
    "https://place.community/es/login?returnTo=https%3A%2F%2Fmi-place.place.community%2Finvite%2Fabc",
  signupUrl:
    "https://place.community/es/login?returnTo=https%3A%2F%2Fmi-place.place.community%2Finvite%2Fabc&mode=signup",
  hubUrl: "https://app.place.community/es/",
  placeHomeUrl: "https://mi-place.place.community/",
  labels,
} as const;

type ActionMock = (
  input: AcceptInvitationInput,
) => Promise<AcceptInvitationResult>;

function buildAction(result: AcceptInvitationResult) {
  return vi.fn<ActionMock>(async () => result);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("InviteAcceptancePanel — render unauth (CU-Accept-1)", () => {
  it("1. visitor sin sesión → header + email preview + 2 CTAs (login + signup) con hrefs correctos", () => {
    const action = buildAction({ status: "success", placeSlug: "mi-place" });
    const onLogout = vi.fn();
    const navigate = vi.fn();

    render(
      <InviteAcceptancePanel
        {...baseProps}
        currentUserEmail={null}
        acceptInvitationAction={action}
        onLogout={onLogout}
        navigate={navigate}
      />,
    );

    expect(screen.getByRole("heading", { name: /Invitation to Mi Place/i })).toBeTruthy();
    expect(screen.getByText(/This invitation is for invitee@example.com/i)).toBeTruthy();

    const loginCta = screen.getByRole("link", { name: /Sign in/i });
    expect(loginCta.getAttribute("href")).toBe(baseProps.loginUrl);

    const signupCta = screen.getByRole("link", { name: /Create account/i });
    expect(signupCta.getAttribute("href")).toBe(baseProps.signupUrl);

    expect(screen.queryByRole("button", { name: /Accept invitation/i })).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });
});

describe("InviteAcceptancePanel — render auth same-email (CU-Accept-2)", () => {
  it("2. user logueado con email matching → botón Accept + link No, thanks", () => {
    const action = buildAction({ status: "success", placeSlug: "mi-place" });
    const onLogout = vi.fn();
    const navigate = vi.fn();

    render(
      <InviteAcceptancePanel
        {...baseProps}
        currentUserEmail="invitee@example.com"
        acceptInvitationAction={action}
        onLogout={onLogout}
        navigate={navigate}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Accept invitation to Mi Place/i }),
    ).toBeTruthy();
    const decline = screen.getByRole("link", { name: /No, thanks/i });
    expect(decline.getAttribute("href")).toBe(baseProps.hubUrl);

    // Match es case-insensitive con btrim (paridad con DEFINER P0008):
    // si el current email viene con uppercase o whitespace, el match sigue
    // siendo positivo y mostramos el panel de accept, no el mismatch.
    cleanup();
    render(
      <InviteAcceptancePanel
        {...baseProps}
        currentUserEmail="  INVITEE@example.com  "
        acceptInvitationAction={action}
        onLogout={onLogout}
        navigate={navigate}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Accept invitation to Mi Place/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/Email does not match/i)).toBeNull();
  });
});

describe("InviteAcceptancePanel — render auth email mismatch (CU-Accept-3)", () => {
  it("3. user logueado con email distinto → panel mismatch + CTA logout con returnTo", async () => {
    const action = buildAction({ status: "success", placeSlug: "mi-place" });
    const onLogout = vi.fn(async () => {});
    const navigate = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <InviteAcceptancePanel
        {...baseProps}
        currentUserEmail="other@example.com"
        acceptInvitationAction={action}
        onLogout={onLogout}
        navigate={navigate}
      />,
    );

    expect(screen.getByRole("heading", { name: /Email does not match/i })).toBeTruthy();
    expect(
      screen.getByText(
        /This invitation is for invitee@example.com\. You are signed in as other@example.com\./i,
      ),
    ).toBeTruthy();

    const logoutCta = screen.getByRole("button", {
      name: /Sign out and sign in as invitee@example.com/i,
    });
    expect(logoutCta).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept invitation/i })).toBeNull();

    await user.click(logoutCta);

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(baseProps.loginUrl),
    );
    // La action NUNCA se invoca en el mismatch path — es un gate pre-action.
    expect(action).not.toHaveBeenCalled();
  });
});

describe("InviteAcceptancePanel — submit accept (CU-Accept-4)", () => {
  it("4. click Accept → action invoked con { token, placeSlug }", async () => {
    const action = buildAction({ status: "success", placeSlug: "mi-place" });
    const onLogout = vi.fn();
    const navigate = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <InviteAcceptancePanel
        {...baseProps}
        currentUserEmail="invitee@example.com"
        acceptInvitationAction={action}
        onLogout={onLogout}
        navigate={navigate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Accept invitation to Mi Place/i }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith({
      token: baseProps.token,
      placeSlug: baseProps.placeSlug,
    });
  });

  it("5. action resolves success → navigate(placeHomeUrl)", async () => {
    const action = buildAction({ status: "success", placeSlug: "mi-place" });
    const onLogout = vi.fn();
    const navigate = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <InviteAcceptancePanel
        {...baseProps}
        currentUserEmail="invitee@example.com"
        acceptInvitationAction={action}
        onLogout={onLogout}
        navigate={navigate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Accept invitation to Mi Place/i }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(baseProps.placeHomeUrl),
    );
  });
});

// Error mappings (tests #6/7/8): cada kind del DEFINER ↔ una copy específica
// del labels. Factor común para no repetir el setup boilerplate (canon
// CLAUDE.md §"sin abstracciones prematuras" — acá la repetición x3 con sólo
// 2 vars cambiantes amerita el helper, evita 60+ LOC duplicadas).
describe("InviteAcceptancePanel — error mappings DEFINER → UX", () => {
  it.each([
    ["6. expired", "expired" as const, labels.errorExpired],
    ["7. already_used", "already_used" as const, labels.errorAlreadyUsed],
    ["8. place_full", "place_full" as const, labels.errorPlaceFull],
  ])("%s → panel error copy correcto", async (_label, kind, expectedCopy) => {
    const action = buildAction({ status: "error", error: { kind } });
    const onLogout = vi.fn();
    const navigate = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <InviteAcceptancePanel
        {...baseProps}
        currentUserEmail="invitee@example.com"
        acceptInvitationAction={action}
        onLogout={onLogout}
        navigate={navigate}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Accept invitation to Mi Place/i }),
    );

    await waitFor(() => expect(screen.getByText(expectedCopy)).toBeTruthy());
    expect(navigate).not.toHaveBeenCalled();
  });
});
