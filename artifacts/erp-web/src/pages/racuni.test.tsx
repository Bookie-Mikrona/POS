import "@testing-library/jest-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DetailInvoiceSheet } from "./racuni";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.PointerEvent = class PointerEvent extends Event {
  button: number;
  ctrlKey: boolean;
  constructor(type: string, props: PointerEventInit = {}) {
    super(type, props);
    this.button = props.button || 0;
    this.ctrlKey = props.ctrlKey || false;
  }
} as any;

const state = vi.hoisted(() => ({
  activeCompany: {
    id: "company-1",
    naziv: "Testno podjetje",
    role: "admin",
  },
  useGetInvoice: vi.fn(),
  useGetInvoicePosReceiptLinks: vi.fn(),
  useLinkInvoicePosReceipt: vi.fn(),
  useUnlinkInvoicePosReceipt: vi.fn(),
  usePostInvoice: vi.fn(),
  linkMutate: vi.fn(),
  unlinkMutate: vi.fn(),
  linkReset: vi.fn(),
  unlinkReset: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetInvoice: state.useGetInvoice,
    useGetInvoicePosReceiptLinks: state.useGetInvoicePosReceiptLinks,
    useLinkInvoicePosReceipt: state.useLinkInvoicePosReceipt,
    useUnlinkInvoicePosReceipt: state.useUnlinkInvoicePosReceipt,
    usePostInvoice: state.usePostInvoice,
    getGetInvoicePosReceiptLinksQueryKey: vi.fn(),
    getListInvoicesQueryKey: vi.fn(),
  };
});

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.activeCompany }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => {
    return (
      <div data-testid="mock-select">
        <select 
          value={value} 
          onChange={(e) => onValueChange(e.target.value)}
          data-testid="select-pos-link-mode-native"
        >
          <option value="invoice_with_delivery_notes">B</option>
          <option value="delivery_note_invoice">A</option>
        </select>
        <div className="hidden">{children}</div>
      </div>
    );
  },
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  SelectValue: () => <span>Value</span>
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn() }),
}));

vi.mock("wouter", () => ({
  Link: ({ children }: any) => <a>{children}</a>,
}));

describe("DetailInvoiceSheet - POS matching", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    state.useGetInvoice.mockReturnValue({
      data: { lines: [] },
      isLoading: false,
    });
    
    state.useLinkInvoicePosReceipt.mockReturnValue({
      mutate: state.linkMutate,
      reset: state.linkReset,
      isPending: false,
      error: null,
    });

    state.useUnlinkInvoicePosReceipt.mockReturnValue({
      mutate: state.unlinkMutate,
      reset: state.unlinkReset,
      isPending: false,
      error: null,
    });

    state.usePostInvoice.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    state.useGetInvoicePosReceiptLinks.mockReturnValue({
      data: {
        links: [
          {
            id: "link-1",
            prejemnicaId: 101,
            enotaName: "Glavna Enota",
            documentNumber: "PR-2024-001",
            netAmount: "100.00",
            bookedTo109: true,
            status: "closed109",
            matchMethod: "exact",
            matchedAt: "2024-01-01T10:00:00Z",
            matchedBy: "Janez Novak"
          }
        ],
        candidates: [
          {
            prejemnicaId: 102,
            enotaName: "Druga Enota",
            documentNumber: "PR-2024-002",
            netAmount: "50.00",
            reason: "Isti dobavitelj, podoben znesek",
            confidence: 0.85,
            matchMethod: "suggested",
            financeComplete: false,
            bookedTo109: false
          }
        ],
        matchHistory: [
          {
            action: "unlinked",
            prejemnicaId: 100,
            status: "unlinked",
            changedBy: "Ana Testna",
            changedAt: "2024-01-01T09:00:00Z"
          },
          {
            action: "closed109",
            prejemnicaId: 101,
            status: "closed109",
            changedBy: "Sistem",
            changedAt: "2024-01-02T10:00:00Z"
          }
        ],
        preview: {
          linkedNet: "100.00",
          invoiceNet: "150.00",
          unclosed109: "50.00",
          canPost: false,
          reasons: ["Račun se še ne ujema popolnoma z vsoto prejemnic."]
        }
      },
      isLoading: false,
    });
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <DetailInvoiceSheet 
          open={true} 
          onOpenChange={vi.fn()} 
          invoice={{
            id: "inv-1",
            type: "received",
            status: "draft",
            invoiceNumber: "INV-001",
            counterpartyName: "Testni Dobavitelj",
            periodName: "Jan 2024",
            invoiceDate: "2024-01-01",
            dueDate: "2024-01-15",
            totalNet: "150.00",
            totalVat: "33.00",
            totalGross: "183.00",
          } as any} 
          onVoid={vi.fn()} 
        />
      </QueryClientProvider>
    );
  };

  it("renders active links, candidates and history properly", () => {
    renderComponent();

    // Check link rendering
    expect(screen.getByText("Prejemnica #101")).toBeInTheDocument();
    expect(screen.getAllByText("109 zaprt").length).toBeGreaterThan(0);
    expect(screen.getByText(/Povezal\/a Janez Novak/)).toBeInTheDocument();
    
    // Check candidate rendering
    expect(screen.getByText("Predlagane prejemnice (1)")).toBeInTheDocument();
    expect(screen.getByText("#102")).toBeInTheDocument();
    expect(screen.getByText("Predlog (85%)")).toBeInTheDocument();

    // Check history rendering
    expect(screen.getByText("Razveza")).toBeInTheDocument();
    expect(screen.getByText("#100")).toBeInTheDocument();
    expect(screen.getByText("Ana Testna")).toBeInTheDocument();

    expect(screen.getByText("Zaprtje 109")).toBeInTheDocument();
    expect(screen.getByText("Sistem")).toBeInTheDocument();
  });

  it("opens confirmation dialog for candidate and executes mutate on confirm", () => {
    renderComponent();

    // Click link on candidate
    const linkButton = screen.getByTestId("button-link-candidate-102");
    fireEvent.click(linkButton);

    // Dialog appears
    expect(screen.getByText("Potrditev povezave")).toBeInTheDocument();
    expect(screen.getAllByText(/#102/).length).toBeGreaterThan(0);
    
    // Check missing finance data warning for mode A
    // We'll skip forcing Select in this test, and instead trust `disables link confirm if mode A is selected...` to do it if we can.
    
    const confirmButton = screen.getByTestId("button-confirm-link");
    expect(confirmButton).not.toBeDisabled();
    
    fireEvent.click(confirmButton);
    expect(state.linkMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prejemnicaId: 102,
          matchMethod: "suggested",
        })
      }),
      expect.any(Object)
    );
  });

  it("disables link confirm if mode A is selected and finance data is incomplete", async () => {
    renderComponent();
    
    // Change to mode A (delivery_note_invoice) via native select mock
    const nativeSelect = screen.getByTestId("select-pos-link-mode-native");
    fireEvent.change(nativeSelect, { target: { value: "delivery_note_invoice" } });
    
    // The candidate button should now be disabled because candidate 102 has financeComplete = false
    const linkButton = screen.getByTestId("button-link-candidate-102");
    expect(linkButton).toBeDisabled();
    expect(linkButton.getAttribute("title")).toBe("Za način A manjkajo finančni podatki.");
  });

  it("opens confirmation dialog for unlinking and executes mutate on confirm", () => {
    state.useGetInvoicePosReceiptLinks.mockReturnValue({
      data: {
        links: [
          {
            id: "link-1",
            prejemnicaId: 105,
            enotaName: "Glavna",
            documentNumber: "PR-2024-005",
            netAmount: "100.00",
            status: "confirmed", // Not closed109, so can be unlinked
            matchMethod: "exact"
          }
        ],
        candidates: [],
        matchHistory: [],
        preview: {}
      },
      isLoading: false,
    });

    renderComponent();

    // Unlink button should exist for status !== closed109
    const unlinkBtn = screen.getByTestId("button-unlink-receipt-105");
    fireEvent.click(unlinkBtn);

    // Dialog appears
    expect(screen.getAllByText("Razveži prejemnico").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/#105/).length).toBeGreaterThan(0);

    const confirmUnlinkBtn = screen.getByTestId("button-confirm-unlink");
    fireEvent.click(confirmUnlinkBtn);

    expect(state.unlinkMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        prejemnicaId: 105
      }),
      expect.any(Object)
    );
  });

  it("renders API errors dynamically", () => {
    state.useLinkInvoicePosReceipt.mockReturnValue({
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      error: {
        data: { error: "Custom API Error Message" }
      },
    });

    renderComponent();
    
    const linkButton = screen.getByTestId("button-link-candidate-102");
    fireEvent.click(linkButton);

    expect(screen.getByText("Custom API Error Message")).toBeInTheDocument();
  });
});
