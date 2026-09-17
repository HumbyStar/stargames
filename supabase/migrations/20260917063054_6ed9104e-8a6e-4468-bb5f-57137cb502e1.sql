ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_description text;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS shipping_description text;

COMMENT ON COLUMN public.products.default_description IS 'Descrição padrão editável usada em notas fiscais e envios';
COMMENT ON COLUMN public.shipments.shipping_description IS 'Descrição confirmada e enviada à transportadora nesta operação';