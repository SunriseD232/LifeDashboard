import RecipeEditor from '@/components/RecipeEditor';

export default function EditRecipePage({ params }: { params: { id: string } }) {
  return <RecipeEditor key={params.id} id={params.id} />;
}
