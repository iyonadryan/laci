import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setup } from './harness';

it('opens a config and edits it', async () => {
  const user = userEvent.setup();
  await setup();
  await user.click(await screen.findByRole('button', { name: /customerLiveStream/ }));
  expect(await screen.findByRole('heading', { name: 'customerLiveStream' })).toBeInTheDocument();
  screen.debug(undefined, 4000);
});
