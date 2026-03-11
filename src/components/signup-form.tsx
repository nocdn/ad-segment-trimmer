import { Loader } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type SignupFormProps = Omit<React.ComponentProps<typeof Card>, "onSubmit"> & {
  email: string
  password: string
  confirmPassword: string
  errorMessage?: string | null
  isPending?: boolean
  onEmailChange?: React.ChangeEventHandler<HTMLInputElement>
  onPasswordChange?: React.ChangeEventHandler<HTMLInputElement>
  onConfirmPasswordChange?: React.ChangeEventHandler<HTMLInputElement>
  onSubmit?: React.FormEventHandler<HTMLFormElement>
  onSwitchToLogin?: () => void
}

export function SignupForm({
  className,
  email,
  password,
  confirmPassword,
  errorMessage,
  isPending = false,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onSwitchToLogin,
  ...props
}: SignupFormProps) {
  return (
    <Card
      className={cn("border-white/10 bg-[#1f1f22] text-white shadow-xl shadow-black/20", className)}
      {...props}
    >
      <CardHeader>
        <CardTitle className="text-white">Create an account</CardTitle>
        <CardDescription className="text-zinc-300">
          Enter your information below to create your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email" className="text-zinc-100">
                Email
              </FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="m@example.com"
                value={email}
                onChange={onEmailChange}
                className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:ring-white/15"
                disabled={isPending}
                required
              />
              <FieldDescription className="text-zinc-400">
                This is just used for authentication and account management. We will never share
                your email.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="password" className="text-zinc-100">
                Password
              </FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={onPasswordChange}
                className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:ring-white/15"
                disabled={isPending}
                required
              />
              <FieldDescription className="text-zinc-400">
                Must be at least 8 characters long.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password" className="text-zinc-100">
                Confirm Password
              </FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={onConfirmPasswordChange}
                className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:ring-white/15"
                disabled={isPending}
                required
              />
              <FieldDescription className="text-zinc-400">
                Please confirm your password.
              </FieldDescription>
            </Field>
            <FieldGroup>
              <Field>
                {errorMessage ? <FieldError className="text-center">{errorMessage}</FieldError> : null}
                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full bg-white text-[#1f1f22] hover:bg-zinc-200"
                >
                  {isPending ? <Loader className="spin" size={16} /> : null}
                  {isPending ? "Creating account..." : "Create Account"}
                </Button>
                <FieldDescription className="text-center text-zinc-300">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => onSwitchToLogin?.()}
                    className="font-medium text-white underline-offset-4 transition hover:text-zinc-200 hover:underline"
                  >
                    Sign in instead
                  </button>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
