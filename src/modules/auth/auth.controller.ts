import type { CookieOptions, Request, Response } from "express";
import { authService } from "./auth.service";
import { sendSuccess } from "../../utils/api-response";
import { ApiError } from "../../utils/api-error";
import { HttpStatus, type HttpStatusValue } from "../../constants/http-status";
import { isProd } from "../../config/env";
import type {
  AcceptInviteDto,
  AuthResult,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SessionContext,
  VerifyEmailDto,
} from "./auth.types";

const REFRESH_COOKIE = "apex_rt";
// Scoped to /api/v1/auth (covers both /refresh and /logout). httpOnly + SameSite=Strict.
const COOKIE_PATH = "/api/v1/auth";

function refreshCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: COOKIE_PATH,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  };
}

function ctxOf(req: Request): SessionContext {
  return { ip: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

function setSession(res: Response, result: AuthResult, status: HttpStatusValue): void {
  res.cookie(REFRESH_COOKIE, result.refreshRaw, refreshCookieOptions(result.refreshExpiresAt));
  sendSuccess(res, { user: result.profile, accessToken: result.accessToken }, "OK", status);
}

export class AuthController {
  register = async (req: Request, res: Response) => {
    const result = await authService.register(req.body as RegisterDto, ctxOf(req));
    setSession(res, result, HttpStatus.CREATED);
  };

  login = async (req: Request, res: Response) => {
    const result = await authService.login(req.body as LoginDto, ctxOf(req));
    setSession(res, result, HttpStatus.OK);
  };

  refresh = async (req: Request, res: Response) => {
    // Defense-in-depth: refresh requires a custom header the SPA sets (07 §3).
    if (!req.get("x-apex-client")) {
      throw ApiError.unauthorized("Missing client header", { code: "MISSING_CLIENT_HEADER" });
    }
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw ApiError.unauthorized("Invalid session", { code: "INVALID_REFRESH" });

    const result = await authService.refresh(raw, ctxOf(req));
    res.cookie(REFRESH_COOKIE, result.refreshRaw, refreshCookieOptions(result.refreshExpiresAt));
    sendSuccess(res, { accessToken: result.accessToken });
  };

  logout = async (req: Request, res: Response) => {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await authService.logout(raw);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    sendSuccess(res, { loggedOut: true }, "Logged out");
  };

  verifyEmail = async (req: Request, res: Response) => {
    await authService.verifyEmail((req.body as VerifyEmailDto).token);
    sendSuccess(res, { verified: true }, "Email verified");
  };

  forgotPassword = async (req: Request, res: Response) => {
    await authService.forgotPassword((req.body as ForgotPasswordDto).email);
    // Uniform response — never reveal whether the email exists.
    sendSuccess(res, { ok: true }, "If that account exists, a reset link has been sent");
  };

  resetPassword = async (req: Request, res: Response) => {
    const { token, password } = req.body as ResetPasswordDto;
    await authService.resetPassword(token, password);
    sendSuccess(res, { reset: true }, "Password updated — please sign in again");
  };

  acceptInvite = async (req: Request, res: Response) => {
    const { token, password } = req.body as AcceptInviteDto;
    await authService.acceptInvite(token, password);
    sendSuccess(res, { activated: true }, "Account activated — please sign in");
  };
}

export const authController = new AuthController();
