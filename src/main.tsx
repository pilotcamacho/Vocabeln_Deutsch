import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import { I18n } from 'aws-amplify/utils'
import { Authenticator, translations } from '@aws-amplify/ui-react'
import '@aws-amplify/ui-react/styles.css'
import outputs from '../amplify_outputs.json'
import App from './App.tsx'
import './index.css'

Amplify.configure(outputs)
I18n.putVocabularies(translations)
I18n.setLanguage('es')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Authenticator.Provider>
      <App />
    </Authenticator.Provider>
  </StrictMode>,
)
