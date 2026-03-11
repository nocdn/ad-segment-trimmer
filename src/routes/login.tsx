import { authClient } from "#/lib/auth-client"
import { getCurrentSession, sanitizeRedirectTarget } from "#/lib/auth-server"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { useState } from "react"

import { LoginForm } from "@/components/login-form"
import { SignupForm } from "@/components/signup-form"

import { AnimatePresence, motion } from "motion/react"

type Mode = "login" | "signup"

export const Route = createFileRoute("/login")({
  validateSearch: (search) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async () => {
    const session = await getCurrentSession()

    if (session) {
      throw redirect({
        to: "/dashboard",
      })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const redirectTarget = sanitizeRedirectTarget(search.redirect)
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  function deriveNameFromEmail(value: string) {
    const localPart = value.split("@")[0]?.trim()

    if (!localPart) {
      return "User"
    }

    return localPart
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode)
    setErrorMessage(null)
    setPassword("")
    setConfirmPassword("")
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isPending) {
      return
    }

    setErrorMessage(null)
    setIsPending(true)

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      })

      if (result.error) {
        throw new Error(result.error.message ?? "Failed to sign in")
      }

      await navigate({
        to: redirectTarget,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed")
    } finally {
      setIsPending(false)
    }
  }

  async function handleSignupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isPending) {
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match")
      return
    }

    setErrorMessage(null)
    setIsPending(true)

    try {
      const result = await authClient.signUp.email({
        email,
        password,
        name: deriveNameFromEmail(email),
      })

      if (result.error) {
        throw new Error(result.error.message ?? "Failed to sign up")
      }

      await navigate({
        to: redirectTarget,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <main className="grid h-svh w-screen grid-cols-[45%_1fr] gap-2 p-18 text-gray-200">
      <div id="copy" className="flex flex-col gap-6">
        <p className="text-[40px] leading-[1.35] font-medium antialiased">
          Trim <span className="text-amber-500">ads</span> and{" "}
          <span className="text-amber-500">sponsors</span> from your audio and video content
        </p>
        <p className="text-[18px] font-[450]">
          Process a <span className="text-blue-400">1 hour</span> podcast in{" "}
          <span className="text-blue-400">under 30 seconds</span>. API and caching support - all
          fully self-hostable.
        </p>
        <p className="mt-auto">
          Built fairly quickly by{" "}
          <a
            href="https://bartoszbak.org"
            target="_blank"
            rel="noreferrer"
            className="text-amber-500"
          >
            Bartek
          </a>
        </p>
      </div>
      <div className="font-inter">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            className="mr-10 ml-auto w-110"
            initial={{ opacity: 0, scale: 0.96, filter: "blur(2px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0)" }}
            exit={{
              opacity: 0,
              scale: 0.96,
              filter: "blur(2px)",
              transition: {
                opacity: { duration: 0.19, ease: [0.26, 0.08, 0.25, 1] },
                default: { duration: 0.27, ease: [0.26, 0.08, 0.25, 1] },
              },
            }}
            key={mode === "login" ? "login" : "signup"}
            transition={{
              duration: 0.27,
              ease: [0.26, 0.08, 0.25, 1],
            }}
          >
            {mode === "login" ? (
              <LoginForm
                email={email}
                password={password}
                errorMessage={errorMessage}
                isPending={isPending}
                onEmailChange={(event) => setEmail(event.target.value)}
                onPasswordChange={(event) => setPassword(event.target.value)}
                onSubmit={handleLoginSubmit}
                onSwitchToSignup={() => switchMode("signup")}
              />
            ) : (
              <SignupForm
                email={email}
                password={password}
                confirmPassword={confirmPassword}
                errorMessage={errorMessage}
                isPending={isPending}
                onEmailChange={(event) => setEmail(event.target.value)}
                onPasswordChange={(event) => setPassword(event.target.value)}
                onConfirmPasswordChange={(event) => setConfirmPassword(event.target.value)}
                onSubmit={handleSignupSubmit}
                onSwitchToLogin={() => switchMode("login")}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}
