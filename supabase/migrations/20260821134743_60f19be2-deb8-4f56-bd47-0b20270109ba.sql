UPDATE public.imported_files
   SET processing_status = 'processado_com_alertas',
       processing_error = 'Débito e crédito não fecham: diferença de -59.52. Contrapartida citada sem conta no período (perna ausente no arquivo do G2).',
       updated_at = now()
 WHERE id = 'bd333209-2098-4cf0-8b19-896c91c7dfb0';