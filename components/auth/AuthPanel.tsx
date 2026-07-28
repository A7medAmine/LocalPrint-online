import React, { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toast } from "../ui/use-toast";
import { useAuth } from "../../hooks/useAuth";

interface AuthPanelProps {
  isRtl: boolean;
}

type Mode = "signin" | "signup";

const AuthPanel: React.FC<AuthPanelProps> = ({ isRtl }) => {
  const { signInWithPassword, signUp, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: authError } =
        mode === "signin"
          ? await signInWithPassword(email, password)
          : await signUp(email, password);

      if (authError) {
        setError(authError.message);
      } else if (mode === "signup") {
        toast({
          title: isRtl ? "تحقق من بريدك الإلكتروني لتأكيد الحساب" : "Check your email to confirm your account",
          variant: "success",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    const { error: authError } = await signInWithGoogle();
    if (authError) setError(authError.message);
  };

  return (
    <div className="max-w-sm mx-auto bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-xl shadow-indigo-100/40 dark:shadow-indigo-900/20 border border-white dark:border-gray-700">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1 text-center">
        {mode === "signin"
          ? (isRtl ? "تسجيل الدخول" : "Sign in")
          : (isRtl ? "إنشاء حساب" : "Create account")}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-5 text-center">
        {isRtl
          ? "اختياري — يمكنك الرفع كضيف بدون تسجيل الدخول"
          : "Optional — you can still upload as a guest without signing in"}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="auth-email">{isRtl ? "البريد الإلكتروني" : "Email"}</Label>
          <Input
            id="auth-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="auth-password">{isRtl ? "كلمة المرور" : "Password"}</Label>
          <Input
            id="auth-password"
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            className="mt-1"
          />
        </div>

        {error && (
          <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-xs border border-red-100 dark:border-red-800/30">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {mode === "signin"
            ? (isRtl ? "تسجيل الدخول" : "Sign in")
            : (isRtl ? "إنشاء حساب" : "Create account")}
        </Button>
      </form>

      <div className="flex items-center gap-2 my-4">
        <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-400 dark:text-gray-500">{isRtl ? "أو" : "or"}</span>
        <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
      </div>

      <Button type="button" variant="outline" className="w-full gap-2" onClick={handleGoogle}>
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {isRtl ? "المتابعة باستخدام Google" : "Continue with Google"}
      </Button>

      <button
        type="button"
        onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
        className="w-full text-center text-xs text-indigo-600 dark:text-indigo-400 hover:underline mt-4"
      >
        {mode === "signin"
          ? (isRtl ? "ليس لديك حساب؟ أنشئ واحداً" : "Don't have an account? Create one")
          : (isRtl ? "لديك حساب بالفعل؟ سجّل الدخول" : "Already have an account? Sign in")}
      </button>
    </div>
  );
};

export default AuthPanel;
