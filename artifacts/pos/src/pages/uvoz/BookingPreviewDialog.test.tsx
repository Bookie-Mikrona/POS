import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { BookingPreviewDialog } from './BookingPreviewDialog';
import { ToastProvider } from '@/components/ui/toast';
import * as toastHook from '@/hooks/use-toast';

const mockToast = vi.fn();
vi.spyOn(toastHook, 'useToast').mockReturnValue({
  toast: mockToast,
  dismiss: vi.fn(),
  toasts: [],
});

const mockOnClose = vi.fn();
const mockOnConfirmed = vi.fn();

const validPreviewData = {
  header: {
    receiptId: 1,
    receiptNumber: "P-001",
    entryDate: "2024-01-01",
    documentDate: "2024-01-01",
    taxDate: "2024-01-01",
    receiptDate: "2024-01-01",
    description: "Nakup materiala",
    reference: "Račun 123",
    sourceType: "MANUAL",
    createdBy: "Admin"
  },
  lines: [
    {
      accountId: "00000000-0000-4000-8000-000000000100",
      accountCode: "3100000",
      accountName: "Material",
      side: "debit",
      amount: "100.00",
    },
    {
      accountId: "00000000-0000-4000-8000-000000000101",
      accountCode: "1090000",
      accountName: "Obračun nabave",
      side: "credit",
      amount: "100.00",
    }
  ],
  debitTotal: "100.00",
  creditTotal: "100.00",
  netAmount: "81.97",
  warnings: [],
  blockingErrors: [],
  previewHash: "abc-123",
  existing: {
    state: "none"
  }
};

describe('BookingPreviewDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockToast.mockReset();
    mockOnClose.mockReset();
    mockOnConfirmed.mockReset();
    global.fetch = vi.fn();
  });

  const setupFetchMock = (response: any, status = 200) => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
    });
  };

  it('renders loading state then data', async () => {
    setupFetchMock(validPreviewData);
    
    render(
      <ToastProvider>
        <BookingPreviewDialog receiptId={1} onClose={mockOnClose} onConfirmed={mockOnConfirmed} />
      </ToastProvider>
    );

    // Varni POS odjemalec pred zahtevo asinhrono pridobi Clerk žeton.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/prejemnice/1/booking-preview'),
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Predogled knjiženja')).toBeInTheDocument();
    });

    // Check header data
    expect(screen.getByText('P-001')).toBeInTheDocument();
    expect(screen.getByText('Račun 123')).toBeInTheDocument();
    
    // Check lines
    expect(screen.getByText('3100000')).toBeInTheDocument();
    expect(screen.getByText('Material')).toBeInTheDocument();
    expect(screen.getByText('1090000')).toBeInTheDocument();
    
    // Check amounts (sl-SI locale converts 100.00 to 100,00)
    expect(screen.getAllByText('100,00').length).toBeGreaterThan(0);
    
    // Submit button should be enabled
    const submitBtn = screen.getByText('Ustvari osnutek');
    expect(submitBtn).not.toBeDisabled();
  });

  it('handles blocking errors by disabling the submit button and showing error', async () => {
    const dataWithBlocker = {
      ...validPreviewData,
      blockingErrors: [{ code: 'NO_ACCOUNT', message: 'Manjka konto za dobavitelja' }]
    };
    setupFetchMock(dataWithBlocker);
    
    render(
      <ToastProvider>
        <BookingPreviewDialog receiptId={1} onClose={mockOnClose} onConfirmed={mockOnConfirmed} />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Kritična napaka')).toBeInTheDocument();
      expect(screen.getByText('Manjka konto za dobavitelja')).toBeInTheDocument();
    });

    const submitBtn = screen.getByText('Ustvari osnutek');
    expect(submitBtn).toBeDisabled();
  });

  it('handles successful confirmation', async () => {
    setupFetchMock(validPreviewData); // for GET
    
    render(
      <ToastProvider>
        <BookingPreviewDialog receiptId={1} onClose={mockOnClose} onConfirmed={mockOnConfirmed} />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Ustvari osnutek')).not.toBeDisabled();
    });

    // Mock POST success
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true })
    });

    fireEvent.click(screen.getByText('Ustvari osnutek'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/prejemnice/1/booking-draft'),
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(mockOnConfirmed).toHaveBeenCalled();
    });
  });

  it('handles 409 stale preview by refetching', async () => {
    setupFetchMock(validPreviewData); // for GET
    
    render(
      <ToastProvider>
        <BookingPreviewDialog receiptId={1} onClose={mockOnClose} onConfirmed={mockOnConfirmed} />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Ustvari osnutek')).not.toBeDisabled();
    });

    // Mock POST 409 stale
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'STALE' })
    });
    
    // Mock the subsequent GET
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...validPreviewData, netAmount: "90.00" })
    });

    fireEvent.click(screen.getByText('Ustvari osnutek'));

    await waitFor(() => {
      // 1 initial GET, 1 POST, 1 retry GET = 3 calls
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
