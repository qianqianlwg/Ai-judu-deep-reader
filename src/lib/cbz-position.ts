export type CbzPosition={version:1;originalHash:string;page:number;zoom:number;fit:'width'|'page';direction:'ltr'|'rtl'};
export function readCbzPosition(raw:string|null,hash:string,count:number):CbzPosition|null{
 if(!raw)return null;let value:unknown;try{value=JSON.parse(raw);}catch{return null;}if(!value||typeof value!=='object'||!('version'in value)||value.version!==1||!('originalHash'in value)||value.originalHash!==hash||!('page'in value)||!Number.isInteger(value.page)||Number(value.page)<1||Number(value.page)>count||!('zoom'in value)||typeof value.zoom!=='number'||value.zoom<25||value.zoom>300||!('fit'in value)||!['width','page'].includes(String(value.fit))||!('direction'in value)||!['ltr','rtl'].includes(String(value.direction)))return null;
 return value as CbzPosition;
}
export function cbzPageUrl(bookId:string,editionId:string,page:number):string{
 if(!bookId||!editionId||!Number.isInteger(page)||page<1||page>1000)throw new Error('CBZ页定位无效');return '/api/books/'+encodeURIComponent(bookId)+'/image?'+new URLSearchParams({editionId,page:String(page)});
}
