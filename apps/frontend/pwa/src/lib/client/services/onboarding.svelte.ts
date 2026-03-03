import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/index.ts';
import { goto } from '$app/navigation';
import { authService, personaService } from '$services/index.ts';

export type OnboardingServiceOptions = BaseFrontendClassOptions;

export type OnboardingServiceInterface = BaseFrontendClassInterface & {
  needsOnboarding(): Promise<boolean>;
  redirectIfNeeded(): Promise<void>;
};

class OnboardingService
  extends BaseFrontendClass<OnboardingServiceOptions>
  implements OnboardingServiceInterface
{
  async needsOnboarding(): Promise<boolean> {
    const user = authService.currentUser;
    if (!user) return false;

    const personas = await personaService.getPersonas(user.id);
    return personas.length === 0;
  }

  async redirectIfNeeded(): Promise<void> {
    const needsOnboarding = await this.needsOnboarding();
    if (needsOnboarding) {
      await goto('/personas/create?onboarding=true');
    }
  }
}

export const onboardingService: OnboardingServiceInterface = new OnboardingService({
  className: 'OnboardingService',
});
