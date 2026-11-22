import path from 'node:path';
export const bookIdOk=id=>id==='main'||id==='demo'||typeof id==='string'&&/^book-[a-f0-9]{16}$/.test(id);
const fixed=[{id:'main',name:'主研究账户'},{id:'demo',name:'演示库'}];
export function booksOf(state){return [...fixed,...(state.books||[])];}
export function bookPath(root,id){
  if(!bookIdOk(id))throw Error('研究账户标识无效');
  return id==='main'?root:path.join(root,'books',id);
}
export function createBook(state,p){
  if(typeof p.name!=='string')throw Error('请输入账户名称');
  const name=p.name.trim();
  if(!name||name.length>32||/[\u0000-\u001f]/u.test(name))throw Error('账户名称须为 1 至 32 个可显示字符');
  const books=booksOf(state);
  if(books.some(b=>b.name===name))throw Error('账户名称已存在');
  if(books.length>=34)throw Error('当前最多建立 32 个自定义账户');
  const book={id:'book-'+crypto.randomUUID().replaceAll('-','').slice(0,16),name};
  (state.books||=[]).push(book);return book;
}
