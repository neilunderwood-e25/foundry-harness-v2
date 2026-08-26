import { z } from "zod";
import { ProjectFoundationSchema, ProjectProfileSchema } from "./project.js";
import { IsoDateTimeSchema, NonEmptyStringSchema, ProjectIdSchema } from "./shared.js";

export const RegisteredProjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: ProjectIdSchema,
    rootDir: NonEmptyStringSchema,
    profile: ProjectProfileSchema,
    foundation: ProjectFoundationSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine((project, context) => {
    if (project.profile.projectId !== project.projectId) {
      context.addIssue({
        code: "custom",
        path: ["profile", "projectId"],
        message: "Profile project ID must match the registered project",
      });
    }
    if (project.foundation.projectId !== project.projectId) {
      context.addIssue({
        code: "custom",
        path: ["foundation", "projectId"],
        message: "Foundation project ID must match the registered project",
      });
    }
  });

export const ProjectRegistrationRequestSchema = z.object({
  rootDir: NonEmptyStringSchema,
  projectId: ProjectIdSchema.optional(),
  acceptFoundationChanges: z.boolean().default(false),
});

export const ProjectRefreshRequestSchema = z.object({
  acceptFoundationChanges: z.boolean().default(false),
});

export type RegisteredProject = z.infer<typeof RegisteredProjectSchema>;
export type ProjectRegistrationRequest = z.infer<typeof ProjectRegistrationRequestSchema>;
export type ProjectRefreshRequest = z.infer<typeof ProjectRefreshRequestSchema>;
