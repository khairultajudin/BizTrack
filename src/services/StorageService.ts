import { supabase } from '../lib/supabase';

export interface StorageUploadOptions {
  bucket: string;
  path: string;
  file: File;
  upsert?: boolean;
}

export interface InvoiceValidationResult {
  valid: boolean;
  error?: string;
}

export interface InvoiceCleanupResult {
  deleted: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Fail-closed role allowlist for creating/updating/deleting payments and invoice attachments.
 * Returns false when role is null, undefined, 'ReadOnly', or unrecognized.
 */
export function canWritePayments(role: string | null | undefined): boolean {
  return role === 'Creator' || role === 'Admin' || role === 'Staff';
}

export class StorageService {
  static readonly INVOICES_BUCKET = 'invoices';
  static readonly MAX_INVOICE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
  static readonly SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes (short-lived)

  /**
   * Validates that a file is a non-empty PDF within the 5 MB limit.
   * Checks both MIME type and file extension.
   */
  static validateInvoiceFile(file: File | null | undefined): InvoiceValidationResult {
    if (!file) {
      return { valid: false, error: 'Please select a PDF file to upload.' };
    }

    const fileName = file.name.trim().toLowerCase();
    const hasPdfExtension = fileName.endsWith('.pdf');
    const hasPdfMime = file.type === 'application/pdf';

    if (!hasPdfExtension || !hasPdfMime) {
      return {
        valid: false,
        error: 'Invalid file type. Only PDF files (.pdf) are allowed.',
      };
    }

    if (file.size <= 0) {
      return {
        valid: false,
        error: 'The selected PDF file is empty.',
      };
    }

    if (file.size > StorageService.MAX_INVOICE_SIZE_BYTES) {
      return {
        valid: false,
        error: 'File size exceeds the maximum allowed limit of 5 MB.',
      };
    }

    return { valid: true };
  }

  /**
   * Generates a collision-safe storage path organized by business and payment:
   * {business_id}/{payment_id}/{unique_filename}.pdf
   */
  static buildInvoicePath(businessId: string, paymentId: string, originalFileName: string): string {
    const cleanBusinessId = businessId.trim();
    const cleanPaymentId = paymentId.trim();

    if (!cleanBusinessId || !cleanPaymentId || cleanBusinessId.includes('/') || cleanPaymentId.includes('/') || cleanBusinessId.includes('..') || cleanPaymentId.includes('..')) {
      throw new Error('Invalid business or payment identifier for invoice storage path.');
    }

    const baseName = originalFileName
      .split(/[/\\]/)
      .pop() || 'invoice.pdf';

    const withoutExt = baseName.replace(/\.pdf$/i, '');
    const sanitizedBase = withoutExt
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'invoice';

    const uniqueSuffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

    const uniqueFileName = `${Date.now()}_${uniqueSuffix}_${sanitizedBase}.pdf`;
    return `${cleanBusinessId}/${cleanPaymentId}/${uniqueFileName}`;
  }

  /**
   * Extracts a clean display filename from an invoice storage path.
   */
  static extractInvoiceFileName(invoicePath: string | null | undefined): string {
    if (!invoicePath) return '';
    const fileSegment = invoicePath.split('/').pop() || invoicePath;
    // Strip the "{timestamp}_{8charUid}_" prefix if present
    const stripped = fileSegment.replace(/^\d+_[a-zA-Z0-9]{8}_/, '');
    return stripped || fileSegment;
  }

  /**
   * Verifies that a storage path belongs to the specified businessId
   * (and optionally a specific paymentId) and is not an external URL or path-traversal attempt.
   */
  static isPathOwnedByBusiness(
    invoicePath: string | null | undefined,
    businessId: string | null | undefined,
    expectedPaymentId?: string | null
  ): boolean {
    if (!invoicePath || !businessId) return false;
    const trimmedPath = invoicePath.trim();
    const trimmedBiz = businessId.trim();
    if (!trimmedPath || !trimmedBiz) return false;
    if (/^https?:\/\//i.test(trimmedPath)) return false;
    if (trimmedPath.includes('..')) return false;

    const segments = trimmedPath.split('/');
    if (segments.length !== 3) return false;
    if (!segments[0] || !segments[1] || !segments[2]) return false;
    if (!segments[2].toLowerCase().endsWith('.pdf')) return false;

    if (segments[0] !== trimmedBiz) return false;

    if (expectedPaymentId !== undefined && expectedPaymentId !== null) {
      const trimmedPaymentId = expectedPaymentId.trim();
      if (!trimmedPaymentId || segments[1] !== trimmedPaymentId) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verifies that an invoice storage path belongs to both the specified businessId AND paymentId.
   */
  static isPathOwnedByPayment(
    invoicePath: string | null | undefined,
    businessId: string | null | undefined,
    paymentId: string | null | undefined
  ): boolean {
    if (!paymentId || !paymentId.trim()) return false;
    return this.isPathOwnedByBusiness(invoicePath, businessId, paymentId);
  }

  /**
   * Uploads a validated invoice PDF to the private 'invoices' bucket.
   * Returns the storage path (never a permanent public URL).
   */
  static async uploadInvoice(businessId: string, paymentId: string, file: File): Promise<string> {
    const validation = this.validateInvoiceFile(file);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid invoice PDF file.');
    }

    const path = this.buildInvoicePath(businessId, paymentId, file.name);

    const { error: uploadError } = await supabase.storage
      .from(this.INVOICES_BUCKET)
      .upload(path, file, {
        upsert: false,
        contentType: 'application/pdf',
      });

    if (uploadError) {
      throw new Error(`Failed to upload invoice PDF: ${uploadError.message}`);
    }

    return path;
  }

  /**
   * Generates a short-lived signed URL for a private storage object.
   */
  static async createSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds = StorageService.SIGNED_URL_EXPIRY_SECONDS
  ): Promise<string> {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(`Failed to generate signed URL: ${error?.message || 'Unable to access file'}`);
    }

    return data.signedUrl;
  }

  /**
   * Generates a short-lived signed URL for an invoice belonging to the user's business.
   */
  static async getInvoiceSignedUrl(
    businessId: string,
    invoicePath: string,
    expiresInSeconds = StorageService.SIGNED_URL_EXPIRY_SECONDS,
    expectedPaymentId?: string
  ): Promise<string> {
    if (!this.isPathOwnedByBusiness(invoicePath, businessId, expectedPaymentId)) {
      throw new Error('Unauthorized: You do not have permission to access this invoice.');
    }

    return this.createSignedUrl(this.INVOICES_BUCKET, invoicePath, expiresInSeconds);
  }

  /**
   * Deletes an invoice PDF from the private 'invoices' bucket after verifying business
   * (and optional payment) ownership.
   */
  static async deleteInvoice(
    businessId: string,
    invoicePath: string,
    expectedPaymentId?: string
  ): Promise<void> {
    if (!this.isPathOwnedByBusiness(invoicePath, businessId, expectedPaymentId)) {
      throw new Error('Unauthorized: You do not have permission to delete this invoice.');
    }

    await this.delete(this.INVOICES_BUCKET, invoicePath);
  }

  /**
   * Safely deletes multiple invoice files belonging to a business (e.g., when cleaning up
   * invoices for a student's payments after student deletion).
   * Any path not owned by businessId is skipped and never sent to Storage remove().
   */
  static async cleanupBusinessInvoices(
    businessId: string,
    invoicePaths: Array<string | null | undefined>
  ): Promise<InvoiceCleanupResult> {
    const deleted: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    if (!businessId || !businessId.trim()) {
      return { deleted, skipped: invoicePaths.filter(Boolean) as string[], errors: ['Missing businessId'] };
    }

    const uniqueValidPaths = new Set<string>();
    for (const rawPath of invoicePaths) {
      if (!rawPath) continue;
      if (this.isPathOwnedByBusiness(rawPath, businessId)) {
        uniqueValidPaths.add(rawPath.trim());
      } else {
        skipped.push(rawPath);
      }
    }

    for (const validPath of uniqueValidPaths) {
      try {
        await this.delete(this.INVOICES_BUCKET, validPath);
        deleted.push(validPath);
      } catch (err: any) {
        errors.push(err?.message || `Failed to delete ${validPath}`);
      }
    }

    return { deleted, skipped, errors };
  }

  /**
   * Uploads a file to the specified bucket and path.
   * Returns the generated public URL.
   */
  static async upload({ bucket, path, file, upsert = false }: StorageUploadOptions): Promise<string> {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert });

    if (uploadError) {
      throw new Error(`Failed to upload file: ${uploadError.message}`);
    }

    return this.generatePublicUrl(bucket, path);
  }

  /**
   * Generates a public URL for a given bucket and path.
   */
  static generatePublicUrl(bucket: string, path: string): string {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * Deletes a file from the specified bucket.
   */
  static async delete(bucket: string, path: string): Promise<void> {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    
    if (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * Replaces an existing file with a new one.
   * Returns the new public URL.
   */
  static async replace(options: StorageUploadOptions): Promise<string> {
    // Upsert gracefully handles replacing files in Supabase.
    return this.upload({ ...options, upsert: true });
  }
}
