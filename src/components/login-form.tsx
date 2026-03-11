import { Loader } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type LoginFormProps = Omit<React.ComponentProps<"div">, "onSubmit"> & {
  email: string
  password: string
  errorMessage?: string | null
  isPending?: boolean
  onEmailChange?: React.ChangeEventHandler<HTMLInputElement>
  onPasswordChange?: React.ChangeEventHandler<HTMLInputElement>
  onSubmit?: React.FormEventHandler<HTMLFormElement>
  onSwitchToSignup?: () => void
}

export function LoginForm({
  className,
  email,
  password,
  errorMessage,
  isPending = false,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onSwitchToSignup,
  ...props
}: LoginFormProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="border-white/10 bg-[#1f1f22] text-white shadow-xl shadow-black/20">
        <CardHeader>
          <CardTitle className="text-white">Login to your account</CardTitle>
          <CardDescription className="text-zinc-300">
            Enter your email below to login to your account
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
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password" className="text-zinc-100">
                    Password
                  </FieldLabel>
                  <a
                    href="#"
                    className="ml-auto inline-block text-sm text-zinc-300 underline-offset-4 hover:text-white hover:underline"
                  >
                    Forgot your password?
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={onPasswordChange}
                  className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:border-white/30 focus-visible:ring-white/15"
                  disabled={isPending}
                  required
                />
              </Field>
              <Field>
                {errorMessage ? <FieldError className="text-center">{errorMessage}</FieldError> : null}
                <Button
                  type="submit"
                  disabled={isPending}
                  className="w-full bg-white text-[#1f1f22] hover:bg-zinc-200"
                >
                  {isPending ? <Loader className="spin" size={16} /> : null}
                  {isPending ? "Logging in..." : "Login"}
                </Button>
                <FieldDescription className="text-center text-zinc-300">
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={() => onSwitchToSignup?.()}
                    className="font-medium text-white underline-offset-4 transition hover:text-zinc-200 hover:underline"
                  >
                    Sign up instead
                  </button>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
