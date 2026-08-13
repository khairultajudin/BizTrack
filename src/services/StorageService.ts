import { supabase } from '../lib/supabase';

export interface StorageUploadOptions {
  bucket: string;
  path: string;
  file: File;
  upsert?: boolean;
}

export class StorageService {
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
