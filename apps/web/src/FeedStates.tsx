import type {ReactNode} from 'react';

export function FeedEmpty({icon,title,description,children}:{icon:ReactNode;title:string;description:string;children?:ReactNode}){
 return <div className="feed-empty"><span className="feed-empty-icon" aria-hidden="true">{icon}</span><h2>{title}</h2><p>{description}</p>{children}</div>;
}

export function FeedSkeleton({label='Loading practices'}:{label?:string}){
 return <div className="feed-grid" aria-label={label} aria-busy="true">{[0,1,2,3,4,5].map(i=><div className="feed-skeleton" key={i}><div/><span/><span/></div>)}</div>;
}
