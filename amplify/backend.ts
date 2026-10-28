import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.ts";
import { data } from "./data/resource.ts";

defineBackend({ auth, data });
