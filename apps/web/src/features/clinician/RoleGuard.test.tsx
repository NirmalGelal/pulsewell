import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { patientUser } from '@/test/handlers';

describe('RoleGuard', () => {
  it('should redirect a patient visiting /clinician to /patient', async () => {
    renderApp('/clinician', patientUser);
    await screen.findByTestId('location');
    await screen.findByText('/patient');
    expect(screen.getByTestId('location')).toHaveTextContent('/patient');
  });
});
