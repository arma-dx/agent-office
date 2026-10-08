import { describe, expect, it } from 'vitest';
import { stepText } from './labels.ts';

describe('the text of a step of a run', () => {
  it('does not claim a routing: the coordinator calls its tool also when no unit fits', () => {
    // The run's summary says what became of the request; the step only says the tool was called.
    expect(stepText({ tool: 'route_task', status: 'succeeded' })).toBe(
      'Yönlendirme kararını bildirdi',
    );
    expect(stepText({ tool: 'route_task', status: 'failed' })).toBe(
      'Yönlendirme kararını bildirdi (olmadı)',
    );
  });

  it('keeps the verb of the other tools and names an unknown tool', () => {
    expect(stepText({ tool: 'submit_for_approval', status: 'succeeded' })).toBe('Onaya sundu');
    expect(stepText({ tool: 'send_email', status: 'blocked' })).toBe(
      'Araç çağrısı: send_email (engellendi)',
    );
  });
});
