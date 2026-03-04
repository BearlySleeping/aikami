import { z } from "zod";
import { SignInProviderSchema } from "../auth.ts";

export const RegisterFormSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	signInProvider: SignInProviderSchema,
	displayName: z.string(),
	uid: z.string().optional(),
});

export type RegisterForm = z.infer<typeof RegisterFormSchema>;
