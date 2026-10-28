import { defineFunction } from "@aws-amplify/backend";

export const altaEstudiante = defineFunction({
  name: "alta-estudiante",
  entry: "./handler.ts",
  resourceGroupName: "auth",
  environment: {
    GRUPO: "estudiante",
  },
});
