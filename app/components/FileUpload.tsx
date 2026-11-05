"use client";
import React, { useState } from "react";
import { IKUpload } from "imagekitio-next";
import { Loader2 } from "lucide-react";
import { IKUploadResponse } from "imagekitio-next/dist/types/components/IKUpload/props";

import { UPLOAD_OPTIONS, validateUpload, type UploadFileType } from "@/lib/upload-validation";

interface FileUploadProps {
    onSuccess: (res: IKUploadResponse) => void;
    onProgress? : (progress: number) => void;
    fileType? : UploadFileType;
}

export default function FileUpload({
    onSuccess,
    onProgress,
    fileType = "image"
}:FileUploadProps) {

    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onError = (err: {message: string}) => {
        setError(err.message)
        setUploading(false)
      };

      const handleSuccess = (res: IKUploadResponse) => {
        setUploading(false)
        setError(null)
        onSuccess(res)
      };

      const handleProgress = (evt: ProgressEvent) => {
        if(evt.lengthComputable && onProgress) {
            const precentComplete = (evt.loaded / evt.total) * 100;
            onProgress(Math.round(precentComplete));
        }
      };

      const handleStartUpload = () => {
        setUploading(true);
        setError(null);
      };

      const validateFile = (file: File) => {
        const validationError = validateUpload(file, fileType);
        setError(validationError);
        return validationError === null;
      };
      const options = UPLOAD_OPTIONS[fileType];

  return (
    <div className="space-y-2">
        <IKUpload
        //Ternary oprator => <value> ? <return if true> : <return if false>
          fileName={fileType}
          accept={options.accept}
          useUniqueFileName={true}
          validateFile={validateFile}
          onError={onError}
          onSuccess={handleSuccess}
          onUploadProgress={handleProgress}
          onUploadStart={handleStartUpload}
          className="file-input file-input-bordered w-full"
          folder={options.folder}
          disabled={uploading}
        />
        {
            uploading && (
                <div className="flex items-center gap-2 text-sm text-primary">
                    <Loader2 className="animate-spin w-4 h-4" />
                    <span>Uploading...</span>
                </div>
            )
        }
        { error && (
            // text-red-600 -> can be use also
            <div role="alert" className="text-error text-sm">{error}</div>
        ) }
    </div>
  );
}
