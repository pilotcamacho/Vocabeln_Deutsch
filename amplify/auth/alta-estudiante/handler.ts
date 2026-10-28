import type { PostConfirmationTriggerHandler } from "aws-lambda";
import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { env } from "$amplify/env/alta-estudiante";

const cliente = new CognitoIdentityProviderClient();

// Todo usuario nuevo entra en el grupo «estudiante» al confirmar su correo.
export const handler: PostConfirmationTriggerHandler = async (evento) => {
  await cliente.send(
    new AdminAddUserToGroupCommand({
      GroupName: env.GRUPO,
      Username: evento.userName,
      UserPoolId: evento.userPoolId,
    }),
  );
  return evento;
};
