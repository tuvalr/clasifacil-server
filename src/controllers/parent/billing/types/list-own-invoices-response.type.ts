import { InvoiceAndPayment } from '../../../../entities/invoice-and-payment.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type ListOwnInvoicesResponse = PublicEntity<InvoiceAndPayment>[];
